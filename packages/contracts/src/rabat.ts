// Calendar dates (ADR 0030), one definition for signals and the browser: UTC days as plain
// arithmetic, and the date in Rabat. No zod here: page scripts import this file, and the browser
// does not load zod.

export const dayMs = 86_400_000;

/** Unix ms of the start of `date` (`2026-10-26`) in UTC. */
export const utcDate = (date: string) => Date.parse(`${date}T00:00:00Z`);

/** `2026-10-26`: the UTC date at `time` (Unix ms). */
export const isoDate = (time: number) => new Date(time).toISOString().slice(0, 10);

/** Hassan Tower, Rabat: where the room's sun rises and the weather is read. */
export const rabatPoint = { latitude: 34.024, longitude: -6.8228 } as const;

/** The IANA zone for all of Morocco. Its offset has changed many times; tzdata knows each one. */
export const rabatTimeZone = 'Africa/Casablanca';

let parts: Intl.DateTimeFormat | undefined;

/**
 * `2026-10-26`: the date in Rabat at `time` (Unix ms), by the runtime's own tzdata. Throws
 * when the runtime does not know the zone.
 */
export function rabatDate(time: number): string {
  parts ??= new Intl.DateTimeFormat('en-US', {
    timeZone: rabatTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const {
    year = '',
    month = '',
    day = '',
  } = Object.fromEntries(parts.formatToParts(time).map((part) => [part.type, part.value]));
  return `${year.padStart(4, '0')}-${month}-${day}`;
}

/** The calendar date after `date` (`2028-02-29` after `2028-02-28`). */
export const nextDate = (date: string) => isoDate(utcDate(date) + dayMs);

/**
 * Unix seconds of the first second whose Rabat date is `date`: local midnight, or the first
 * second after it when clocks jumped over midnight (2008-06-01 began at 01:00). Since 1913
 * Rabat has been at UTC+00 or +01, so the start lies within three hours of midnight UTC. The
 * search assumes the Rabat date never steps back, which holds for all 72 Africa/Casablanca
 * transitions from 1913 in tzdata 2026e: each fall-back near midnight repeats 23:00 of the
 * same date (2008-08-31), and each spring-forward skips from 23:59:59 to 01:00.
 */
export function rabatDayStart(date: string): number {
  let low = utcDate(date) / 1000 - 3 * 3600;
  let high = low + 6 * 3600;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (rabatDate(middle * 1000) >= date) high = middle;
    else low = middle + 1;
  }
  return low;
}
