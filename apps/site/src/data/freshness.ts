import type { Envelope } from '@min7/contracts';

const units = [
  ['day', 24 * 60 * 60],
  ['hour', 60 * 60],
  ['minute', 60],
] as const;

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'always' });

/** `3 hours ago`, `just now`: how long before `now` the instant `iso` was. */
function timeAgo(iso: string, now: Date): string {
  const seconds = Math.max(0, (now.getTime() - Date.parse(iso)) / 1000);
  for (const [unit, size] of units) {
    if (seconds >= size) return relative.format(-Math.floor(seconds / size), unit);
  }
  return 'just now';
}

/**
 * The line a page shows under a source's numbers, computed at build time: when the data was
 * last refreshed, and whether it is out of date. Null when there is no data to qualify.
 */
export function freshness(envelope: Envelope<unknown>, now: Date): string | null {
  if (envelope.fetchedAt === null || envelope.data === null) return null;
  const updated = `Updated ${timeAgo(envelope.fetchedAt, now)}`;
  return envelope.stale ? `${updated}; this may be out of date.` : `${updated}.`;
}
