/**
 * What the room says at a moment (ADR 0043): one pure function from a complete set of inputs to
 * a complete state. The build, the browser and the terminal all render its result, and none of
 * them decides a fact of its own. No DOM, no zod, no clock.
 *
 * A moment is one of three kinds. `live` is this instant, seen with a clock: only it can say a
 * record is playing. `built` is the build, whose page must hold for as long as it is served: it
 * has no clock, so no sky or lamp, and its objects carry the time they were observed. `past` is a
 * moment already over: a dated event or scrobble counts only if it came before it, and a daily
 * total for its own date says nothing, as the total may hold the hours after it.
 */
import type { ListeningSnapshot, ShippingEvent } from '@min7/contracts';
import { rabatDate } from '@min7/contracts/rabat';
import { type HeatLevel, heatmap } from './heat.ts';
import { type NowPlayingLine, nowPlaying } from './listening.ts';
import type { Answer } from './live.ts';
import { plural } from './plural.ts';
import {
  isCatHour,
  isLate,
  type Moon,
  moonAt,
  moonShown,
  rabatTime,
  type Sky,
  skyAt,
  windowWords,
} from './sky.ts';
import { readWeather, type Weather } from './weather.ts';
import {
  dateRange,
  dayMs,
  dayWords,
  isoDate,
  rabatStamp,
  repoName,
  tokens,
  utcDate,
  utcDay,
} from './words.ts';

/** Where a reading came from: the browser's or Worker's own request, the build, or fixtures. */
export type Origin = 'live' | 'build' | 'sample';

/** One source's accepted answer. */
export interface Reading<Data> extends Pick<Answer<Data>, 'data' | 'fetchedAt' | 'at'> {
  origin: Origin;
  /**
   * The last instant this answer may be said to describe now, or null if it may not: the latest
   * refresh did not bring it, or it is the build's (src/lib/live.ts, `follow`).
   */
  currentUntil: number | null;
}

export interface RoomPost {
  title: string;
  /** Its date as written, `2026-10-26`. */
  date: string;
}

export type RoomListening = Pick<ListeningSnapshot, 'nowPlaying' | 'recent'>;

/** Only tokens and dates: costs stay out of the room by never entering it (ADR 0014). */
interface RoomUsage {
  days: { date: string; totalTokens: number }[];
  /** The source's own total for the month it was read in, or null if it reports none. */
  monthTokens: number | null;
}

export interface RoomInputs {
  /** `knowsRabat()`: without Morocco's current rules the hour there is a guess. */
  knowsRabat: boolean;
  /** Every published post, oldest first: the same list as /writing. */
  posts: readonly RoomPost[];
  /** Null is unknown. A reading of nothing is a known empty. */
  shipping: Reading<{ events: ShippingEvent[] }> | null;
  usage: Reading<RoomUsage> | null;
  listening: Reading<RoomListening> | null;
  /** The raw `/v1/weather` body: `readWeather` checks it against the instant. */
  weather: unknown;
}

export interface RoomMoment {
  kind: 'live' | 'built' | 'past';
  instant: number;
}

interface RoomWindow {
  sky: Sky;
  moon: Moon;
  moonShown: boolean;
  weather: Weather | null;
  label: string;
}

interface RoomLamp {
  late: boolean;
  cat: boolean;
  /** The time in Rabat, `03:12`. */
  time: string;
}

interface RoomBook {
  title: string;
  /** Which of the two spine colours: fixed by the post's place among all posts, so it never moves. */
  tone: 0 | 1;
}

/** One repository on one UTC day, by the biggest thing that happened there. */
interface RoomPin {
  repo: string;
  date: string;
  kind: 'release' | 'merge' | 'push';
  /** Events behind it, drawn as up to three lines. */
  count: number;
}

export interface RoomState {
  /** Some of what the room shows is fixtures. */
  sample: boolean;
  /** Null without a clock: the build's static scene. */
  window: RoomWindow | null;
  lamp: RoomLamp | null;
  shelf: { books: RoomBook[]; words: string };
  pins: {
    pins: RoomPin[];
    /** The newest push or merge: stars and releases say nothing about the code. */
    latest: ShippingEvent | null;
    /** Null is unknown. */
    words: string | null;
  };
  screen: { cells: { date: string; level: HeatLevel | null }[]; words: string | null };
  record: {
    state: 'playing' | 'resting' | 'unknown';
    line: NowPlayingLine | null;
    words: string | null;
  };
}

/** The room as a clock sees it: a live or past moment always has its window and lamp. */
export type ClockedRoom = RoomState & { window: RoomWindow; lamp: RoomLamp };

/** The bottom shelf holds this many spines: its width in the scene, over five pixels each. */
export const shelfSlots = 19;
/** The corkboard's three by two notes. */
export const pinSlots = 6;
/** The framed screen's columns, a week each. */
export const screenWeeks = 11;

const isShipped = (event: ShippingEvent) =>
  event.type === 'release' ||
  event.type === 'merge' ||
  (event.type === 'push' && event.commits > 0);

/** Which pin an event belongs to. */
export const pinKey = (event: ShippingEvent) => `${event.repo} ${utcDay(event.at)}`;

const kinds = ['push', 'merge', 'release'];

function pinsAt(reading: RoomInputs['shipping'], { kind, instant }: RoomMoment): RoomState['pins'] {
  if (reading === null) return { pins: [], latest: null, words: null };
  const events = reading.data.events.filter(
    (event) => isShipped(event) && (kind !== 'past' || Date.parse(event.at) <= instant)
  );
  const byPin = new Map<string, RoomPin>();
  for (const event of events) {
    const type = event.type as RoomPin['kind'];
    const key = pinKey(event);
    const pin = byPin.get(key);
    if (pin === undefined) {
      byPin.set(key, { repo: event.repo, date: utcDay(event.at), kind: type, count: 1 });
    } else {
      pin.count += 1;
      if (kinds.indexOf(type) > kinds.indexOf(pin.kind)) pin.kind = type;
    }
  }
  const pins = [...byPin.values()].slice(0, pinSlots);
  const newest = pins[0];
  const words =
    newest !== undefined
      ? `Shipped to ${repoName(newest.repo)} on ${dayWords(newest.date)}`
      : // The snapshot holds only the newest events, so an empty past proves nothing.
        kind === 'past'
        ? null
        : `Nothing shipped lately, as of ${dayWords(rabatDate(reading.at))}`;
  const latest = events.find((event) => event.type === 'push' || event.type === 'merge') ?? null;
  return { pins, latest, words };
}

function shelfAt(posts: readonly RoomPost[], { instant }: RoomMoment): RoomState['shelf'] {
  const today = rabatDate(instant);
  const shown = posts
    .map(({ title, date }, index) => ({ title, date, tone: (index % 2) as 0 | 1 }))
    .filter((post) => post.date <= today);
  const newest = shown.at(-1);
  return {
    books: shown.slice(-shelfSlots).map(({ title, tone }) => ({ title, tone })),
    words:
      newest === undefined
        ? 'No posts yet'
        : `${plural(shown.length, 'post', 'posts')}, newest: ${newest.title}`,
  };
}

const earlier = (a: string, b: string) => (a < b ? a : b);

function screenAt(
  reading: RoomInputs['usage'],
  { kind, instant }: RoomMoment
): RoomState['screen'] {
  if (reading === null) return { cells: [], words: null };
  const observed = rabatDate(reading.at);
  const today = rabatDate(instant);
  const end = earlier(observed, today);
  // A day still running, or one a past moment sits inside, has no total to show.
  const closed = kind === 'past' ? isoDate(utcDate(today) - dayMs) : end;
  const days = reading.data.days.filter(({ date }) => date <= closed);
  const cells = heatmap(days, end, screenWeeks).cells.map(({ date, level }) => ({ date, level }));
  const last = earlier(closed, end);
  const range = dateRange(`${last.slice(0, 8)}01`, last);
  const { monthTokens } = reading.data;
  // The observation's own day was still running when it was taken.
  const asOf = last === observed ? `, as of ${rabatStamp(reading.fetchedAt)}` : '';
  if (last === observed && monthTokens !== null) {
    return { cells, words: `${tokens(monthTokens)} tokens, ${range}${asOf}` };
  }
  const month = days.filter(({ date }) => date.startsWith(last.slice(0, 7)));
  if (month.length === 0) return { cells, words: null };
  const total = month.reduce((sum, { totalTokens }) => sum + totalTokens, 0);
  // A sum of the days held speaks for the period only if it holds every one of them.
  const whole = month.length === Number(last.slice(8));
  return { cells, words: `${tokens(total)} tokens${whole ? '' : ' on record'}, ${range}${asOf}` };
}

const lineWords = ({ lead, track }: NowPlayingLine) =>
  track === null ? lead : `${lead} ${track.track} by ${track.artist}`;

function recordAt(
  reading: RoomInputs['listening'],
  { kind, instant }: RoomMoment
): RoomState['record'] {
  const unknown = { state: 'unknown', line: null, words: null } as const;
  if (reading === null) return unknown;
  let { data } = reading;
  if (kind === 'past') {
    // The current track is dated when the answer was taken: after this moment, it never played.
    data = {
      nowPlaying: reading.at <= instant ? data.nowPlaying : null,
      recent: data.recent.filter(({ playedAt }) => Date.parse(playedAt) <= instant),
    };
    if (data.nowPlaying === null && data.recent.length === 0) return unknown;
  }
  const now =
    kind === 'live' &&
    reading.origin === 'live' &&
    reading.currentUntil !== null &&
    instant <= reading.currentUntil;
  const line = nowPlaying(data, reading.fetchedAt, now);
  return { state: line.playing ? 'playing' : 'resting', line, words: lineWords(line) };
}

function clockAt(
  { knowsRabat, weather: body }: RoomInputs,
  { kind, instant }: RoomMoment
): Pick<RoomState, 'window' | 'lamp'> {
  if (kind === 'built') return { window: null, lamp: null };
  const sky = skyAt(instant);
  const moon = moonAt(instant);
  // The weather has no record: a past moment shows a clear window and makes no claim.
  const weather = (kind === 'live' ? readWeather(body, instant) : undefined) ?? null;
  return {
    window: {
      sky,
      moon,
      moonShown: moonShown(sky, moon),
      weather,
      label: windowWords(sky, moon, weather?.words),
    },
    lamp: {
      late: knowsRabat && isLate(instant),
      cat: knowsRabat && isCatHour(instant),
      time: rabatTime(instant),
    },
  };
}

/** The room at `moment`, from `inputs` alone: the same arguments always give the same state. */
export function roomState(
  inputs: RoomInputs,
  moment: RoomMoment & { kind: 'live' | 'past' }
): ClockedRoom;
export function roomState(inputs: RoomInputs, moment: RoomMoment): RoomState;
export function roomState(inputs: RoomInputs, moment: RoomMoment): RoomState {
  const { shipping, usage, listening, posts } = inputs;
  return {
    sample: [shipping, usage, listening].some((reading) => reading?.origin === 'sample'),
    ...clockAt(inputs, moment),
    shelf: shelfAt(posts, moment),
    pins: pinsAt(shipping, moment),
    screen: screenAt(usage, moment),
    record: recordAt(listening, moment),
  };
}

/** Which parts of the room differ, for a renderer that redraws only those. */
export const changedParts = (from: RoomState, to: RoomState) =>
  (Object.keys(to) as (keyof RoomState)[]).filter(
    (part) => JSON.stringify(from[part]) !== JSON.stringify(to[part])
  );

/** What the build hands the browser and the terminal: the inputs its own room was drawn from. */
export interface RoomSeed {
  /** When the build drew the room: its `built` moment. */
  builtAt: number;
  /** How long after it was taken a listening answer can describe now. */
  listeningLimitMs: number;
  inputs: Pick<RoomInputs, 'posts' | 'shipping' | 'usage' | 'listening'>;
}

/** The whole set `roomState` needs, from a seed and what only the reader knows. */
export const seededInputs = (seed: RoomSeed, knowsRabat: boolean): RoomInputs => ({
  ...seed.inputs,
  knowsRabat,
  weather: undefined,
});

/** `answer` as a reading from this renderer's own request. */
export const liveReading = <Data>(
  { data, fetchedAt, at }: Answer<Data>,
  currentUntil: number | null
): Reading<Data> => ({ data, fetchedAt, at, origin: 'live', currentUntil });
