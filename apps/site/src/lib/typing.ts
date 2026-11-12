/**
 * Typing on /stats (ADR 0033): which `/v1/monkeytype` data the browser may show, checked as
 * the contract states it, and the words the build and the live script both render. The
 * browser does not load the contracts' zod schemas; test/live.test.ts holds this reader to
 * them.
 */
import type { MonkeytypeSnapshot, TypingBest } from '@min7/contracts';
import { calendarDate } from './live.ts';

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
