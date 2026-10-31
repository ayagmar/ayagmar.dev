/**
 * Typing on /stats (ADR 0033): which `/v1/monkeytype` data the browser may show, checked as
 * the contract states it, and the words the build and the live script both render. The
 * browser does not load the contracts' zod schemas; test/live.test.ts holds this reader to
 * them.
 */
import type { MonkeytypeSnapshot, TypingBest } from '@min7/contracts';
import { calendarDate, day } from './live.ts';

const number = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;
const percent = (value: unknown) => number(value) && (value as number) <= 100;

const best = (value: unknown) => {
  const { wpm, acc, raw, consistency, date } = Object(value);
  return (
    value === null ||
    (number(wpm) && percent(acc) && number(raw) && percent(consistency) && calendarDate(date))
  );
};

const lengths = { time: ['15', '30', '60', '120'], words: ['10', '25', '50', '100'] } as const;

/** `data` if it is a Monkeytype snapshot, every slot present, else undefined. */
export function readMonkeytype(data: unknown): MonkeytypeSnapshot | undefined {
  const { time, words } = Object(data);
  // An array has the lengths as indexes, but the contract wants an object.
  return !Array.isArray(time) &&
    !Array.isArray(words) &&
    lengths.time.every((length) => best(Object(time)[length])) &&
    lengths.words.every((length) => best(Object(words)[length]))
    ? (data as MonkeytypeSnapshot)
    : undefined;
}

/** The words /stats shows around the bests, at build time and live. */
export const typingWords = {
  noData: 'No typing data yet.',
  none: 'No personal bests at these settings yet.',
  noHeadline: 'No 60-second best yet.',
  settings: 'Monkeytype personal bests: English · normal · no punctuation or numbers.',
};

/** One row per best there is: `15 seconds`, its speed, its accuracy, and the day it was set. */
export function bestRows({ time, words }: MonkeytypeSnapshot) {
  const row = (label: string, best: TypingBest) =>
    best === null
      ? []
      : [
          {
            label,
            wpm: `${Math.round(best.wpm)} wpm`,
            acc: `${Math.round(best.acc)}% accuracy`,
            date: best.date,
          },
        ];
  return [
    ...lengths.time.flatMap((length) => row(`${length} seconds`, time[length])),
    ...lengths.words.flatMap((length) => row(`${length} words`, words[length])),
  ];
}

/** The 60-second best, the one the section leads with; null when there is none. */
export function headline({ time }: MonkeytypeSnapshot) {
  const sixty = time[60];
  return sixty === null
    ? null
    : {
        wpm: `${Math.round(sixty.wpm)} wpm`,
        text: ` over 60 seconds at ${Math.round(sixty.acc)}% accuracy, set `,
        date: sixty.date,
      };
}

const exact = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' });

/** `14 Jan 2021`, for `2021-01-14`: the day a best was set, as the page shows it without JavaScript. */
export const dayDate = (date: string) => exact.format(Date.parse(date));

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/**
 * How long before the reader's own date at `now` the calendar date `date` was: `today`,
 * `yesterday`, `12 days ago`, `3 months ago`, `last year`, `5 years ago`. `date` is a day, not
 * an instant, so it is never moved into the reader's time zone. A day in the future (a clock
 * behind) is today.
 */
export function daysAgo(date: string, now: number): string {
  const days = Math.max(0, day(now) - Date.parse(date) / 86_400_000);
  if (days < 30) return relative.format(-days, 'day');
  if (days < 365) return relative.format(-Math.max(1, Math.floor(days / 30.44)), 'month');
  return relative.format(-Math.max(1, Math.floor(days / 365.25)), 'year');
}

/** Rewrites every `time[data-day]` on the page relative to `now`, its exact day in the title. */
export function relabelDays(now: number): void {
  for (const time of document.querySelectorAll<HTMLTimeElement>('time[data-day]')) {
    time.textContent = daysAgo(time.dateTime, now);
    time.title = dayDate(time.dateTime);
  }
}
