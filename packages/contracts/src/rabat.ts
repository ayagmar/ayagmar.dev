// The calendar date in Rabat (ADR 0030), one definition for signals and the browser. No zod
// here: the /stats page script imports this file, and the browser does not load zod.

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
export function nextDate(date: string): string {
  const [year = 0, month = 0, day = 0] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

/**
 * Unix seconds of the first second whose Rabat date is `date`: local midnight, or the first
 * second after it when clocks jumped over midnight (2008-06-01 began at 01:00). Since 1913
 * Rabat has been at UTC+00 or +01, so the start lies within three hours of midnight UTC. The
 * search assumes the Rabat date never steps back, which holds for all 72 Africa/Casablanca
 * transitions from 1913 in tzdata 2026e: each fall-back near midnight repeats 23:00 of the
 * same date (2008-08-31), and each spring-forward skips from 23:59:59 to 01:00.
 */
export function rabatDayStart(date: string): number {
  const [year = 0, month = 0, day = 0] = date.split('-').map(Number);
  let low = Date.UTC(year, month - 1, day) / 1000 - 3 * 3600;
  let high = low + 6 * 3600;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (rabatDate(middle * 1000) >= date) high = middle;
    else low = middle + 1;
  }
  return low;
}
