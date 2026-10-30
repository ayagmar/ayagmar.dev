/** A /now page not updated for this long says it may be out of date (ADR 0035). */
export const staleAfterDays = 90;

const dayMs = 24 * 60 * 60 * 1000;

/** Whether a page last updated on `updated` (a `YYYY-MM-DD` day, UTC) is stale at `now` (ms). */
export const isStale = (updated: string, now: number) =>
  now - Date.parse(updated) > staleAfterDays * dayMs;
