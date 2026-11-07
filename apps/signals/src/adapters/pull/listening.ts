// Last.fm: now playing and recent scrobbles every pull; top artists and weekly scrobble counts
// on their own cadences, carried from the stored snapshot between reads (ADR 0009).
import {
  type ListeningSnapshot,
  lastfmArtistSchema,
  lastfmRecentTracksSchema,
  lastfmTopArtistsSchema,
  lastfmTrackSchema,
  listeningSnapshotSchema,
} from '@min7/contracts';
import { rabatDate } from '@min7/contracts/rabat';
import { logEvent } from '../../security/log.ts';
import { D1SnapshotStore } from '../../storage/d1.ts';
import { dayReadsHeldUntil, holdDayReads } from '../../storage/daily.ts';
import type { StoredSnapshot } from '../../storage/types.ts';
import type { PullAdapter } from '../types.ts';
import {
  checkSnapshot,
  fromUnixSeconds,
  getJson,
  getOptionalJson,
  orNull,
  PullError,
  type Schema,
  type UpstreamResponse,
} from './http.ts';
import { lastfmEndpoint, lastfmForm, readLastfm } from './lastfm.ts';
import {
  type DayRead,
  dayReadsAllowed,
  listeningDaysHistory,
  readListeningDay,
} from './listening-days.ts';
import { readSecret } from './secrets.ts';

const listLimit = 10;
// Ten tracks with their image lists are about 10 KiB.
const maxBytes = 128 * 1024;

/** The parts of a snapshot that a pull need not read: what the stored one says of them. */
interface Carried {
  topArtists: ListeningSnapshot['topArtists'];
  thisWeek: number | null;
  lastWeek: number | null;
}

type SlowPart = keyof Carried;

/** The Last.fm answers a listening snapshot is built from; null is a part not read. */
export interface ListeningRaw {
  recentTracks: UpstreamResponse;
  topArtists: UpstreamResponse | null;
  thisWeek: UpstreamResponse | null;
  lastWeek: UpstreamResponse | null;
  /** What a part with no readable answer falls back to; absent with no stored snapshot. */
  carried?: Carried;
  /** The dates read for daily history; absent outside the hourly window (ADR 0038). */
  days?: DayRead[];
}

const day = 24 * 60 * 60;

/** Unix seconds of Monday 00:00 UTC of the week containing `now`. */
export function weekStart(now: Date): number {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000;
  const daysSinceMonday = (now.getUTCDay() + 6) % 7;
  return midnight - daysSinceMonday * day;
}

const minute = 60_000;

/**
 * The first pull of a slot reads the part. The offsets keep the two apart and out of the first
 * five minutes of an hour, the day reads' window (ADR 0038), so the heaviest pull grows no
 * heavier. Fifteen minutes is the source's `stale` threshold; all-time totals barely move.
 */
const thisWeekSlot = { everyMs: 15 * minute, offsetMs: 7 * minute };
const topArtistsSlot = { everyMs: 60 * minute, offsetMs: 30 * minute };

const slotOf = ({ everyMs, offsetMs }: typeof thisWeekSlot, time: number) =>
  Math.floor((time - offsetMs) / everyMs);

/**
 * A snapshot stored this soon after Monday 00:00 UTC may come from a pull that began in the old
 * week. Longer than a pull can last: the runner gives up on a fetch after 20 seconds.
 */
const weekSettledMs = minute;

/**
 * Last week's count is read again this long into Monday, past the morning's late scrobbles,
 * clear of the other reads' minutes and the day reads' window. Its first read comes at the worst
 * moment for it, and without this one a wrong answer would stand all week.
 */
const lastWeekRepairMs = (12 * 60 + 15) * minute;

/**
 * What a pull at `now` carries from `stored`, and which parts it reads. A part with nothing to
 * carry is read at every pull, so one that failed with no value to fall back on comes back at
 * the next. Week counts carry only inside their week: a count of another week is wrong however
 * Last.fm is doing, so a failed read at the rollover leaves null. `fetchedAt` is the only clock
 * needed, which leaves the snapshot's shape alone and survives a restart.
 */
function slowParts(stored: StoredSnapshot | null, now: number) {
  const snapshot = listeningSnapshotSchema.safeParse(stored?.snapshot);
  const fetchedAt = Date.parse(stored?.fetchedAt ?? '');
  if (!snapshot.success || Number.isNaN(fetchedAt)) {
    return { due: { topArtists: true, thisWeek: true, lastWeek: true } };
  }
  const { topArtists, scrobbles } = snapshot.data;
  const monday = weekStart(new Date(now)) * 1000;
  const inThisWeek = fetchedAt >= monday + weekSettledMs;
  const repairAt = monday + lastWeekRepairMs;
  const thisWeek = inThisWeek ? scrobbles.thisWeek : null;
  const lastWeek = inThisWeek ? scrobbles.lastWeek : null;
  return {
    carried: { topArtists, thisWeek, lastWeek },
    due: {
      topArtists:
        topArtists === null || slotOf(topArtistsSlot, fetchedAt) !== slotOf(topArtistsSlot, now),
      thisWeek: thisWeek === null || slotOf(thisWeekSlot, fetchedAt) !== slotOf(thisWeekSlot, now),
      lastWeek: lastWeek === null || (fetchedAt < repairAt && now >= repairAt),
    },
  };
}

/** Whether normalize can use `part`'s answer: a failure carrying would otherwise hide. */
const unread = (part: SlowPart, response: UpstreamResponse | null) =>
  (part === 'topArtists'
    ? readOptional(response, lastfmTopArtistsSchema)
    : readOptional(response, lastfmRecentTracksSchema)) === null;

export const listening: PullAdapter<ListeningRaw, ListeningSnapshot> = {
  id: 'listening',
  intervalSeconds: 60,

  async fetch(env, signal) {
    const apiKey = readSecret(env, 'LASTFM_API_KEY');
    if (apiKey === undefined) throw new PullError('not_configured');
    const call = (method: string, params: Record<string, string>) => ({
      signal,
      maxBytes,
      form: lastfmForm(apiKey, method, params),
    });
    /**
     * A refusal holds these reads as it holds the day reads (ADR 0038): the source's own
     * cooldown cannot, as the recent tracks' success clears it. They are the optional reads,
     * so a hold costs a carried value a little age and the pull nothing else.
     */
    const readSlowParts = async () => {
      const stored = await new D1SnapshotStore(env.DB).get('listening');
      const now = Date.now();
      const { due, carried } = slowParts(stored, now);
      const held =
        Object.values(due).some(Boolean) && (await dayReadsHeldUntil(env.DB, 'listening')) > now;
      const ask = (part: SlowPart, method: string, params: Record<string, string>) =>
        due[part] && !held ? getOptionalJson(lastfmEndpoint, call(method, params)) : null;
      const thisMonday = weekStart(new Date(now));
      const lastMonday = thisMonday - 7 * day;
      // Only `@attr.total` of the weekly calls is read, so one item per page is enough.
      const [topArtists, thisWeek, lastWeek] = await Promise.all([
        ask('topArtists', 'user.gettopartists', { period: 'overall', limit: String(listLimit) }),
        ask('thisWeek', 'user.getrecenttracks', { limit: '1', from: String(thisMonday) }),
        ask('lastWeek', 'user.getrecenttracks', {
          limit: '1',
          from: String(lastMonday),
          to: String(thisMonday),
        }),
      ]);
      const answers = { topArtists, thisWeek, lastWeek };
      const failed = (Object.keys(answers) as SlowPart[]).filter(
        (part) => due[part] && !held && unread(part, answers[part])
      );
      if (failed.length > 0) {
        logEvent('warn', 'listening part unread', { source: 'listening', parts: failed.join() });
      }
      const refusedUntil = Math.max(...Object.values(answers).map((a) => a?.retryAt ?? 0));
      if (refusedUntil > 0) await holdDayReads(env.DB, 'listening', rabatDate(now), refusedUntil);
      return { ...answers, ...(carried === undefined ? {} : { carried }) };
    };
    const [days, recentTracks, parts] = await Promise.all([
      dayReadsAllowed(env.DB, Date.now()).then((dates) =>
        Promise.all(dates.map((date) => readListeningDay(date, apiKey, signal)))
      ),
      getJson(lastfmEndpoint, call('user.getrecenttracks', { limit: String(listLimit) })),
      readSlowParts(),
    ]);
    return { recentTracks, ...parts, ...(days.length === 0 ? {} : { days }) };
  },

  normalize(raw) {
    const recent = readLastfm(raw.recentTracks, lastfmRecentTracksSchema).recenttracks;
    const tracks = items(recent.track, lastfmTrackSchema);

    let nowPlaying: ListeningSnapshot['nowPlaying'] = null;
    const played: ListeningSnapshot['recent'] = [];
    for (const item of tracks) {
      const track = trackOf(item);
      if (track === null) continue;
      if (item['@attr']?.nowplaying === 'true') {
        nowPlaying ??= track;
      } else if (item.date !== undefined && played.length < listLimit) {
        played.push({ ...track, playedAt: fromUnixSeconds(Number(item.date.uts)) });
      }
    }

    const top = readOptional(raw.topArtists, lastfmTopArtistsSchema);
    const topArtists =
      top === null
        ? (raw.carried?.topArtists ?? null)
        : items(top.topartists.artist, lastfmArtistSchema).flatMap((artist) => {
            const name = artist.name.trim();
            return name === ''
              ? []
              : [{ artist: name, plays: Number(artist.playcount), url: lastfmUrl(artist.url) }];
          });

    return checkSnapshot(listeningSnapshotSchema, {
      nowPlaying,
      recent: played,
      topArtists: topArtists?.slice(0, listLimit) ?? null,
      scrobbles: {
        thisWeek: weekTotal(raw.thisWeek) ?? raw.carried?.thisWeek ?? null,
        lastWeek: closedWeek(weekTotal(raw.lastWeek), raw.carried?.lastWeek ?? null),
      },
    });
  },

  history: (snapshot, raw) => listeningDaysHistory(snapshot, raw.days ?? []),
};

const readOptional = <T>(response: UpstreamResponse | null, schema: Schema<T>) =>
  response === null ? null : orNull(() => readLastfm(response, schema));

/** The items of a Last.fm list that match `schema`; one it cannot read is skipped. */
function items<T>(list: unknown[] | Record<string, unknown>, schema: Schema<T>): T[] {
  return (Array.isArray(list) ? list : [list]).flatMap((item) => {
    const parsed = schema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

type LastfmTrack = ReturnType<typeof lastfmTrackSchema.parse>;

function trackOf(item: LastfmTrack) {
  const track = item.name.trim();
  const artist = item.artist['#text'].trim();
  if (track === '' || artist === '') return null;
  const album = item.album?.['#text'].trim() ?? '';
  return { track, artist, album: album === '' ? null : album, url: lastfmUrl(item.url) };
}

const lastfmPage = /^https:\/\/www\.last\.fm\/\S*$/;

const lastfmUrl = (url: string | undefined) =>
  url !== undefined && lastfmPage.test(url) ? url : null;

/** A finished week's count only grows, so the repair read cannot be the wrong answer itself. */
const closedWeek = (read: number | null, carried: number | null) =>
  read === null || carried === null ? (read ?? carried) : Math.max(read, carried);

function weekTotal(response: UpstreamResponse | null): number | null {
  const parsed = readOptional(response, lastfmRecentTracksSchema);
  return parsed === null ? null : Number(parsed.recenttracks['@attr'].total);
}
