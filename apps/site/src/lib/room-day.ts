/**
 * What the room says of a past date (ADR 0044), from that date's records in `/v1/days`: which
 * blocks a date needs, what the browser accepts of them, and every fact worded once. No DOM, no
 * zod, no clock. Only the scrub loads this, so home's first load does not carry it.
 *
 * A record is a day summary: it says what the date came to, never what held at an instant in it.
 * So the words name the date, and name what is not known rather than leave it to look like zero.
 */
import type { ListeningDay, ShippingActivityDay, WeatherDay } from '@min7/contracts';
import { nextDate, rabatDayStart } from '@min7/contracts/rabat';
import { weatherCodes } from '@min7/contracts/weather-codes';
import { type Counts, shipped, shippedCount } from './day-words.ts';
import { heatmap } from './heat.ts';
import { type NowPlayingLine, nowPlayingWords } from './listening.ts';
import { calendarDate, instantMs, list, readAnswer, text, whole } from './live.ts';
import { plural } from './plural.ts';
import { type PastDay, pinSlots, type RoomPin, type RoomState, screenWeeks } from './room-state.ts';
import { rabatTime } from './sky.ts';
import { dayMs, dayWords, isoDate, rabatStamp, tokens, utcDate } from './words.ts';

/** Every date is drawn at this hour in Rabat: dark all year, so the moon shows its phase. */
const roomHour = 21;

/** The instant whose sky a past date shows. A clock change that day moves it an hour. */
export const dayInstant = (date: string) => (rabatDayStart(date) + roomHour * 3600) * 1000;

/** A usage day as the room keeps it: tokens and a date, as costs never enter the room (ADR 0014). */
interface UsageDay {
  date: string;
  totalTokens: number;
}

interface Days {
  'shipping-activity': ShippingActivityDay;
  'llm-usage': UsageDay;
  listening: ListeningDay;
  weather: WeatherDay;
}

export type Series = keyof Days;

/**
 * A month of a series as read: the days with a record. The block's `fetchedAt` is left behind: it
 * dates the source's latest snapshot, and proves nothing about a row an old pull last wrote.
 */
export interface Block<Day> {
  days: Day[];
}

/** What is held of a month: a block, not asked for or not answered yet, or a failed read. */
export type Held<Day> = Block<Day> | 'waiting' | 'failed';

/** What is held of `series` for `month`, `YYYY-MM`. */
export type Lookup = <Name extends Series>(series: Name, month: string) => Held<Days[Name]>;

const monthOf = (date: string) => date.slice(0, 7);

/** The earliest date the framed screen can show for `date`, as `heatmap` counts back from a Sunday. */
const screenFrom = (date: string) => isoDate(utcDate(date) - (screenWeeks * 7 - 1) * dayMs);

/** The blocks `date` draws from: its own month of each series, and the screen's weeks of usage. */
export function monthsFor(date: string): [Series, string][] {
  const month = monthOf(date);
  const usage = new Set<string>();
  for (let time = utcDate(screenFrom(date)); time <= utcDate(date); time += 7 * dayMs) {
    usage.add(monthOf(isoDate(time)));
  }
  usage.add(month);
  return [
    ['shipping-activity', month],
    ['listening', month],
    ['weather', month],
    ...[...usage].map((name): [Series, string] => ['llm-usage', name]),
  ];
}

const instantOr = (value: unknown) => instantMs(value, true) !== undefined;

const counted = (value: unknown) => {
  const { pushes, commits, merges, releases, stars } = Object(value);
  return [pushes, commits, merges, releases, stars].every((count) => whole(count));
};

const slot = (value: unknown) => {
  if (value === null) return true;
  const { code, at, origin } = Object(value);
  return Number.isSafeInteger(code) && instantOr(at) && (origin === 'live' || origin === 'archive');
};

/** Each series' day as the contract states it (packages/contracts/src/snapshots). */
const dayChecks: Record<Series, (day: Record<string, unknown>) => boolean> = {
  'shipping-activity': (day) =>
    counted(day) &&
    typeof day.reposComplete === 'boolean' &&
    list(day.repos, 50, (repo) => text(Object(repo).repo) && counted(repo)),
  'llm-usage': ({ totalTokens }) => whole(totalTokens),
  listening: ({ count, last, asOf }) => {
    const { track, artist, playedAt } = Object(last);
    return (
      whole(count) &&
      instantOr(asOf) &&
      (last === null || (text(track) && text(artist) && instantOr(playedAt)))
    );
  },
  weather: ({ day, night }) => slot(day) && slot(night),
};

/**
 * The block for `month` in a `/v1/days/<series>` body if the page may use it at `now`, else
 * undefined: one bad day fails the block, as a month read in part would look like days without a
 * record. Usage keeps its date and tokens and nothing else.
 */
export function readBlock<Name extends Series>(
  series: Name,
  month: string,
  body: unknown,
  now: number
): Block<Days[Name]> | undefined {
  const answer = readAnswer(
    body,
    series,
    (data) => {
      const { days } = Object(data);
      const fits = (value: unknown) => {
        const day = Object(value);
        return (
          calendarDate(day.date) && monthOf(day.date) === month && dayChecks[series](day as never)
        );
      };
      return list(days, 31, fits) ? (days as Days[Name][]) : undefined;
    },
    now
  );
  if (answer === undefined) return;
  const { data } = answer;
  return {
    days:
      series === 'llm-usage'
        ? (data as UsageDay[]).map(({ date, totalTokens }) => ({ date, totalTokens }) as never)
        : data,
  };
}

/** `, so far, as of 26 Oct, 09:00` while a row's own `asOf` is before `end`. */
const soFar = (asOf: string, end: number) =>
  Date.parse(asOf) < end ? `, so far, as of ${rabatStamp(asOf)}` : '';

const rabatEnd = (date: string) => rabatDayStart(nextDate(date)) * 1000;

const unread = (what: string, date: string) => `${what} for ${dayWords(date)} could not be read`;
const noRecord = (what: string, date: string) => `No ${what} on record for ${dayWords(date)}`;

/** The biggest thing in `counts`, or null if nothing in them is shipping. */
function pinKind({ releases, merges, pushes, commits }: Counts): RoomPin['kind'] | null {
  if (releases > 0) return 'release';
  if (merges > 0) return 'merge';
  return pushes > 0 && commits > 0 ? 'push' : null;
}

function pinsOn(date: string, held: Held<ShippingActivityDay>): RoomState['pins'] {
  const none = { pins: [], latest: null };
  if (held === 'waiting') return { ...none, words: null };
  if (held === 'failed') return { ...none, words: unread('Shipping', date) };
  const day = held.days.find((entry) => entry.date === date);
  if (day === undefined) return { ...none, words: noRecord('shipping', date) };
  const pin = (repo: string, counts: Counts): RoomPin[] => {
    const kind = pinKind(counts);
    return kind === null ? [] : [{ repo, date, kind, count: shippedCount(counts) }];
  };
  const named = day.repos
    .flatMap((entry) => pin(entry.repo, entry))
    .sort((a, b) => b.count - a.count)
    .slice(0, pinSlots);
  // A day's names may be withheld (ADR 0038), and what it counted still happened.
  const pins = named.length > 0 ? named : pin('', day);
  // A shipping row does not say when it was last written, so it may have stopped short of the
  // day's end: `on record` is all it can claim, zero included.
  const what = pins.length === 0 ? 'Nothing shipped' : shipped(day);
  return { pins, latest: null, words: `${what} on record for ${dayWords(date)}, UTC` };
}

function screenOn(date: string, lookup: Lookup): RoomState['screen'] {
  const months = monthsFor(date).filter(([series]) => series === 'llm-usage');
  const days = months.flatMap(([, month]) => {
    const held = lookup('llm-usage', month);
    return typeof held === 'string' ? [] : held.days;
  });
  const cells = heatmap(
    days.filter((day) => day.date <= date),
    date,
    screenWeeks
  ).cells.map((cell) => ({ date: cell.date, level: cell.level }));
  const held = lookup('llm-usage', monthOf(date));
  if (held === 'waiting') return { cells, words: null };
  if (held === 'failed') return { cells, words: unread('Agent usage', date) };
  const day = held.days.find((entry) => entry.date === date);
  if (day === undefined) return { cells, words: noRecord('agent usage', date) };
  // As for shipping: a usage row cannot show it covers the whole day.
  return { cells, words: `${tokens(day.totalTokens)} tokens on record for ${dayWords(date)}` };
}

function recordOn(date: string, held: Held<ListeningDay>): RoomState['record'] {
  const unknown = { state: 'unknown', line: null } as const;
  if (held === 'waiting') return { ...unknown, words: null };
  if (held === 'failed') return { ...unknown, words: unread('Listening', date) };
  const day = held.days.find((entry) => entry.date === date);
  if (day === undefined) return { ...unknown, words: noRecord('listening', date) };
  const { count, last, asOf } = day;
  const zone = soFar(asOf, rabatEnd(date));
  if (count === 0) {
    return { state: 'resting', line: null, words: `Nothing played on ${dayWords(date)}${zone}` };
  }
  const plays = `${plural(count, 'play', 'plays')} on ${dayWords(date)}${zone}`;
  if (last === null) return { state: 'resting', line: null, words: plays };
  const line: NowPlayingLine = {
    lead: 'Last played',
    playing: false,
    track: { track: last.track, artist: last.artist, url: null },
    at: last.playedAt,
    when: '',
  };
  return { state: 'resting', line, words: `${nowPlayingWords(line)}. ${plays}` };
}

function weatherOn(
  date: string,
  held: Held<WeatherDay>
): Pick<PastDay, 'weather' | 'weatherWords'> {
  if (held === 'waiting') return { weather: null, weatherWords: undefined };
  if (held === 'failed') return { weather: null, weatherWords: 'its weather could not be read' };
  // The window is drawn after dark, so the day's reading says nothing of what it shows.
  const reading = held.days.find((entry) => entry.date === date)?.night ?? null;
  const known = reading === null ? undefined : weatherCodes[reading.code];
  if (reading === null || known === undefined) {
    return { weather: null, weatherWords: 'no weather on record' };
  }
  const [state, name] = known;
  const origin = reading.origin === 'archive' ? `, from Open-Meteo's archive` : '';
  const words = `${name} at ${rabatTime(Date.parse(reading.at))}${origin}`;
  return { weather: { state, words }, weatherWords: words };
}

/** What `date`'s records say, as far as `lookup` holds them. */
export function dayFacts(date: string, lookup: Lookup): PastDay {
  const month = monthOf(date);
  return {
    pins: pinsOn(date, lookup('shipping-activity', month)),
    screen: screenOn(date, lookup),
    record: recordOn(date, lookup('listening', month)),
    ...weatherOn(date, lookup('weather', month)),
  };
}

const weekday = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'long' });
const dayMonth = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'long',
});

/** `Tuesday 14 October`, with the year when it is not `today`'s. */
export function dateTitle(date: string, today: string): string {
  const time = utcDate(date);
  const year = date.slice(0, 4) === today.slice(0, 4) ? '' : ` ${date.slice(0, 4)}`;
  return `${weekday.format(time)} ${dayMonth.format(time)}${year}`;
}

/** The date `back` days before `today`, and how many days `date` is before it. */
export const dateBack = (today: string, back: number) => isoDate(utcDate(today) - back * dayMs);
export const daysBack = (date: string, today: string) =>
  Math.round((utcDate(today) - utcDate(date)) / dayMs);
