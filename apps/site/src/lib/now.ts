/** A /now page not updated for this long says it may be out of date (ADR 0035). */
export const staleAfterDays = 90;

const dayMs = 24 * 60 * 60 * 1000;

/** The first instant (ms) at which a page last updated on `updated` (`YYYY-MM-DD`, UTC) is stale. */
export const staleFrom = (updated: string) => Date.parse(updated) + staleAfterDays * dayMs + 1;

/** Whether the page is stale at `now` (ms): more than 90 days after `updated`. */
export const isStale = (updated: string, now: number) => now >= staleFrom(updated);
