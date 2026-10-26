// Last.fm: what min7_ scrobbled on today's date in Rabat in each past year (ADR 0030).
import {
  calendarDatePattern,
  historyMaxYears,
  historyPageLimit,
  type ListeningHistorySnapshot,
  lastfmHistoryPageSchema,
  lastfmUserInfoSchema,
  listeningHistorySnapshotSchema,
} from '@min7/contracts';
import { nextDate, rabatDate, rabatDayStart } from '@min7/contracts/rabat';
import { D1ProgressStore } from '../../storage/progress.ts';
import type { SourceStatus } from '../../storage/types.ts';
import type { PullAdapter } from '../types.ts';
import { checkSnapshot, getJson, PullError, type UpstreamResponse } from './http.ts';
import { lastfmEndpoint, lastfmUser, readLastfm } from './listening.ts';
import { readSecret } from './secrets.ts';

/** `user.getInfo` is about 1 KiB. */
const infoMaxBytes = 16 * 1024;
/** A full page of 200 scrobbles is about 160 KiB; long titles can double it. */
const pageMaxBytes = 384 * 1024;

const minute = 60_000;
/** A finished snapshot is read again after this long: at most four a day (ADR 0030). */
const refreshMs = 7 * 60 * minute;
/** The next year of a pull in progress is due this long after the last. */
const continueMs = 30_000;
/** After a failure on a date with no snapshot yet, the first retry; later ones back off to
 * half the time since midnight, at most an hour apart: 31 tries on a day that fails. */
const retryMs = 5 * minute;
const maxRetryMs = 60 * minute;
/** A pull must end this long before midnight in Rabat, so its write lands on its own date. */
const finishMarginMs = 5_000;

/** The past years whose `describedDate` exists, newest first: 29 February only in leap years. */
function pastYears(describedDate: string, firstYear: number): number[] {
  const years = [];
  for (let year = Number(describedDate.slice(0, 4)) - 1; year >= firstYear; year--) {
    if (calendarDatePattern.test(`${year}${describedDate.slice(4)}`)) years.push(year);
  }
  return years;
}

/** One past year's day in Rabat: from the start of that date to the start of the next. */
export interface HistoryDay {
  year: number;
  /** Unix seconds, inclusive, as Last.fm's `from` is. */
  from: number;
  /** Unix seconds, exclusive, as Last.fm's `to` is (checked live on 2026-10-26). */
  to: number;
}

/** `describedDate`'s day in `year`, its bounds from tzdata. */
function dayIn(year: number, describedDate: string): HistoryDay {
  const date = `${year}${describedDate.slice(4)}`;
  return { year, from: rabatDayStart(date), to: rabatDayStart(nextDate(date)) };
}

/** Each past year's day matching `describedDate`, newest first. */
export function pastDays(describedDate: string, firstYear: number): HistoryDay[] {
  return pastYears(describedDate, firstYear).map((year) => dayIn(year, describedDate));
}

/**
 * The year the account was registered, in Rabat. A registration Last.fm does not give, before
 * Last.fm existed or after `describedDate` is a failed discovery, never an empty history.
 */
function registrationYear(response: UpstreamResponse, describedDate: string): number {
  const seconds = Number(readLastfm(response, lastfmUserInfoSchema).user.registered.unixtime);
  const date = rabatDate(seconds * 1000);
  if (date < '2002-01-01' || date > describedDate) throw new PullError('upstream_malformed');
  return Number(date.slice(0, 4));
}

type Year = ListeningHistorySnapshot['years'][number];

/**
 * A day's count and top track from the first page of its scrobbles, or null for a day with
 * none. The page must be page 1 of min7_'s, hold exactly the scrobbles its total says page 1
 * holds, each inside the day and newest first; anything else fails the pull, since skipping a
 * scrobble would change the counts. The track playing now is left out. Past 200 scrobbles
 * only the newest 200 are read, and `read` says so.
 */
export function summarizeDay(day: HistoryDay, response: UpstreamResponse): Year | null {
  const fail = () => new PullError('upstream_malformed');
  const page = readLastfm(response, lastfmHistoryPageSchema).recenttracks;
  const attr = page['@attr'];
  const total = Number(attr.total);
  if (
    attr.user.toLowerCase() !== lastfmUser ||
    attr.page !== '1' ||
    Number(attr.perPage) !== historyPageLimit ||
    Number(attr.totalPages) !== Math.ceil(total / historyPageLimit)
  ) {
    throw fail();
  }
  const scrobbles = (Array.isArray(page.track) ? page.track : [page.track]).filter(
    (item) => item['@attr']?.nowplaying !== 'true'
  );
  if (scrobbles.length !== Math.min(total, historyPageLimit)) throw fail();
  if (total === 0) return null;

  // Exact artist and title after trimming the ends; nested maps, so no name can collide.
  const tallies = new Map<string, Map<string, Tally>>();
  let previous = Number.POSITIVE_INFINITY;
  for (const item of scrobbles) {
    const at = Number(item.date?.uts);
    const artist = item.artist['#text'].trim();
    const track = item.name.trim();
    if (!(at >= day.from && at < day.to && at <= previous) || artist === '' || track === '') {
      throw fail();
    }
    previous = at;
    const byTrack = tallies.get(artist) ?? new Map<string, Tally>();
    tallies.set(artist, byTrack);
    const tally = byTrack.get(track);
    // Newest first, so each later sighting is earlier in the day.
    if (tally === undefined) byTrack.set(track, { plays: 1, first: at });
    else {
      tally.plays++;
      tally.first = at;
    }
  }
  let top: Candidate | undefined;
  for (const [artist, byTrack] of tallies) {
    for (const [track, tally] of byTrack) {
      const candidate = { artist, track, tally };
      if (top === undefined || ranksAbove(candidate, top)) top = candidate;
    }
  }
  if (top === undefined) throw fail();
  return {
    year: day.year,
    scrobbles: total,
    read: scrobbles.length,
    top: { track: top.track, artist: top.artist, plays: top.tally.plays },
  };
}

interface Tally {
  plays: number;
  /** Unix seconds of the track's first scrobble that day. */
  first: number;
}

type Candidate = { artist: string; track: string; tally: Tally };

/** Most plays; then the first played that day; then artist and title in code point order. */
function ranksAbove(a: Candidate, b: Candidate): boolean {
  if (a.tally.plays !== b.tally.plays) return a.tally.plays > b.tally.plays;
  if (a.tally.first !== b.tally.first) return a.tally.first < b.tally.first;
  return (compareCodePoints(a.artist, b.artist) || compareCodePoints(a.track, b.track)) < 0;
}

/** By Unicode code point, not UTF-16 unit or locale, so the order is the same everywhere. */
function compareCodePoints(a: string, b: string): number {
  const x = Array.from(a, (c) => c.codePointAt(0) ?? 0);
  const y = Array.from(b, (c) => c.codePointAt(0) ?? 0);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const difference = (x[i] ?? 0) - (y[i] ?? 0);
    if (difference !== 0) return difference;
  }
  return x.length - y.length;
}

/** Every Last.fm answer of one whole pull: what the fixtures record (fixtures/README.md). */
export interface HistoryAnswers {
  describedDate: string;
  registration: UpstreamResponse;
  /** Newest year first, each with the first page of its day. */
  days: (HistoryDay & { page: UpstreamResponse })[];
}

/**
 * The snapshot a whole pull's answers make, in one go: what the adapter builds a year per
 * invocation, from the same functions. The days must be exactly those the date asks for.
 */
export function historyFromAnswers(raw: HistoryAnswers): ListeningHistorySnapshot {
  const firstYear = registrationYear(raw.registration, raw.describedDate);
  const expected = pastDays(raw.describedDate, firstYear);
  if (
    raw.days.length !== expected.length ||
    raw.days.some(
      ({ year, from, to }, i) =>
        year !== expected[i]?.year || from !== expected[i]?.from || to !== expected[i]?.to
    )
  ) {
    throw new PullError('upstream_malformed');
  }
  return listeningHistory.normalize({
    describedDate: raw.describedDate,
    firstYear,
    years: raw.days.flatMap((day) => summarizeDay(day, day.page) ?? []),
  });
}

/** What the invocations of one pull have read so far, kept in `pull_progress`. */
interface State {
  firstYear: number;
  /** How many of the date's past days have been read, newest first. */
  read: number;
  years: Year[];
}

/** Stored progress for `describedDate`, if it is still well formed; else start over. */
function readState(value: unknown, describedDate: string): State | undefined {
  const { firstYear, read, years } = Object(value);
  const parsed = listeningHistorySnapshotSchema.safeParse({ describedDate, firstYear, years });
  if (!parsed.success || !Number.isInteger(read) || read < 0 || read > historyMaxYears) return;
  return { firstYear: parsed.data.firstYear, read, years: parsed.data.years };
}

export const listeningHistory: PullAdapter<ListeningHistorySnapshot, ListeningHistorySnapshot> = {
  id: 'listening-history',
  intervalSeconds: refreshMs / 1000,

  /**
   * On a new date in Rabat, with the snapshot for an earlier one, due since the last attempt,
   * so the first trigger of the date runs it ahead of sources only just due; soon again while
   * a pull is in progress; after a failure on a date with no snapshot, again
   * in 5 minutes, then at half the time since midnight, at most an hour later; with today's
   * snapshot, 7 hours after the last attempt (ADR 0030).
   */
  dueAt(status: SourceStatus, now: number): number {
    const last = status.lastAttemptAt ?? Number.NEGATIVE_INFINITY;
    const midnight = rabatDayStart(rabatDate(now)) * 1000;
    if (status.lastErrorCode === 'in_progress' && last >= midnight) return last + continueMs;
    const current = status.fetchedAt !== null && Date.parse(status.fetchedAt) >= midnight;
    if (current) return last + refreshMs;
    if (last < midnight) return last;
    return last + Math.min(maxRetryMs, Math.max(retryMs, (last - midnight) / 2));
  },

  /**
   * One part of a pull per cron invocation: the registration and the newest year on the
   * first, one more year on each next. Returns the whole history once every year is read,
   * and until then fails with `in_progress`, the part saved in D1.
   */
  async fetch(env, signal) {
    const apiKey = readSecret(env, 'LASTFM_API_KEY');
    if (apiKey === undefined) throw new PullError('not_configured');
    // One date for the whole pull, whatever the clock says later.
    const describedDate = rabatDate(Date.now());
    const progress = new D1ProgressStore(env.DB, 'listening-history');
    const saved = await progress.load();
    let step = 0;
    let state: State | undefined;
    if (saved?.describedDate === describedDate) {
      state = readState(saved.state, describedDate);
      if (state !== undefined) step = saved.step;
    }

    // The key goes in the POST form, out of the URL that Workers traces record.
    const form = (method: string, params: Record<string, string> = {}) =>
      new URLSearchParams({ method, user: lastfmUser, api_key: apiKey, format: 'json', ...params });
    if (state === undefined) {
      const registration = await getJson(lastfmEndpoint, {
        signal,
        maxBytes: infoMaxBytes,
        form: form('user.getinfo'),
      });
      state = { firstYear: registrationYear(registration, describedDate), read: 0, years: [] };
    }
    const years = pastYears(describedDate, state.firstYear);
    if (years.length > historyMaxYears) throw new PullError('over_budget');

    // Only the year this invocation reads: tzdata lookups for all 24 would cost milliseconds.
    const next = years[state.read];
    if (next !== undefined) {
      const day = dayIn(next, describedDate);
      const page = await getJson(lastfmEndpoint, {
        signal,
        maxBytes: pageMaxBytes,
        form: form('user.getrecenttracks', {
          limit: String(historyPageLimit),
          page: '1',
          from: String(day.from),
          to: String(day.to),
        }),
      });
      const year = summarizeDay(day, page);
      state = {
        ...state,
        read: state.read + 1,
        years: year === null ? state.years : [...state.years, year],
      };
    }

    // A pull that crossed midnight in Rabat would label yesterday's answers as today's. One
    // that ends in the last seconds before it is dropped too: its snapshot, written after
    // midnight, would make the new date look done.
    if (rabatDate(Date.now() + finishMarginMs) !== describedDate) {
      throw new PullError('date_changed');
    }
    if (state.read < years.length) {
      // False when an overlapping invocation saved first: its part stands, this one is dropped.
      await progress.save(describedDate, step, state);
      throw new PullError('in_progress');
    }
    await progress.clear();
    return { describedDate, firstYear: state.firstYear, years: state.years };
  },

  /** The history as read, checked: each year once, newest first, one the date has. */
  normalize(raw) {
    const expected = pastYears(raw.describedDate, raw.firstYear);
    let index = 0;
    for (const { year } of raw.years) {
      while (index < expected.length && expected[index] !== year) index++;
      if (index++ === expected.length) throw new PullError('upstream_malformed');
    }
    return checkSnapshot(listeningHistorySnapshotSchema, raw);
  },
};
