import type { Envelope } from '@min7/contracts';
import type { SignalsMode } from './reader.ts';

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
 * last refreshed, and whether it is out of date. Null when there is no data to qualify. In
 * fixtures mode (local builds and public Previews) the data is the shared fixtures, some of
 * it invented, and is labelled as such.
 */
export function freshness(
  envelope: Envelope<unknown>,
  now: Date,
  mode: SignalsMode
): string | null {
  if (envelope.fetchedAt === null || envelope.data === null) return null;
  if (mode === 'fixtures') return 'Sample data (fixtures mode).';
  const updated = `Updated ${timeAgo(envelope.fetchedAt, now)}`;
  return envelope.stale ? `${updated}; this may be out of date.` : `${updated}.`;
}
