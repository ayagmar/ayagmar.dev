/** A /now page not updated for this long says it may be out of date (ADR 0035). */
export const staleAfterDays = 90;

/** The first instant (ms) at which a page last updated on `updated` (`YYYY-MM-DD`, UTC) is stale. */
export function staleFrom(updated: string): number {
  const date = new Date(updated);
  return date.setUTCDate(date.getUTCDate() + staleAfterDays) + 1;
}

/** Whether the page is stale at `now` (ms): more than 90 days after `updated`. */
export const isStale = (updated: string, now: number) => now >= staleFrom(updated);
