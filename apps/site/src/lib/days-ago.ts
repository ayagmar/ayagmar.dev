/**
 * How long ago a calendar day was, in the reader's own calendar: /stats' typing bests and /now's
 * age. A module of its own that imports nothing, so /now loads only this: the contracts' Rabat
 * module and `day` in src/lib/live.ts sit in the `live` chunk (astro.config.ts), which /now would
 * otherwise load whole (budgets, ADR 0017).
 */
const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/**
 * How long before the reader's own date at `now` the calendar date `date` was: `today`,
 * `yesterday`, `12 days ago`, `3 months ago`, `last year`, `5 years ago`. `date` is a day, not
 * an instant, so it is never moved into the reader's time zone. A day in the future (a clock
 * behind) is today.
 */
export function daysAgo(date: string, now: number): string {
  const today = new Date(now);
  const days = Math.max(
    0,
    (Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) -
      Date.parse(`${date}T00:00:00Z`)) /
      86_400_000
  );
  if (days < 30) return relative.format(-days, 'day');
  if (days < 365) return relative.format(-Math.max(1, Math.floor(days / 30.44)), 'month');
  return relative.format(-Math.max(1, Math.floor(days / 365.25)), 'year');
}
