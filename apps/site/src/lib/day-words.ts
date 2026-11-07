/**
 * A date in full, what a shipping day counts and says, and where a date's page is: shared by the
 * day and year pages, /stats and the room's past days, so it holds nothing the browser must not
 * load. Apart from src/lib/words.ts because home's first load needs none of it.
 */
import type { ShippingActivityDay } from '@min7/contracts';
import { plural } from './plural.ts';
import { dateWords } from './words.ts';

/** `26 October`. */
export const dayName = dateWords({ day: 'numeric', month: 'long' });
/** `26 Oct 2026`. */
export const shortDate = dateWords({ day: 'numeric', month: 'short', year: 'numeric' });
/** `26 October 2026`. */
export const longDate = dateWords({ day: 'numeric', month: 'long', year: 'numeric' });

export type Counts = Pick<
  ShippingActivityDay,
  'pushes' | 'commits' | 'merges' | 'releases' | 'stars'
>;

export const dayPath = (date: string) => `/day/${date}`;

export const shippedCount = (day: Pick<Counts, 'pushes' | 'merges' | 'releases'>) =>
  day.pushes + day.merges + day.releases;

/** What shipped, `2 merges · 5 commits in 1 push · 1 release`; empty for nothing. Stars are
 * attention, not shipping, as on the strip. */
export function shipped({
  merges,
  commits,
  pushes,
  releases,
}: Pick<Counts, 'merges' | 'commits' | 'pushes' | 'releases'>): string {
  return [
    merges > 0 && plural(merges, 'merge', 'merges'),
    pushes > 0 && `${plural(commits, 'commit', 'commits')} in ${plural(pushes, 'push', 'pushes')}`,
    releases > 0 && plural(releases, 'release', 'releases'),
  ]
    .filter(Boolean)
    .join(' · ');
}
