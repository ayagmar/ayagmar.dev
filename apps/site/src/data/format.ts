import type { ShippingEvent } from '@min7/contracts';

const plural = (count: number, one: string, many: string) =>
  `${count.toLocaleString('en')} ${count === 1 ? one : many}`;

/** `ayagmar/runnerd` -> `runnerd`. */
export const repoName = (repo: string) => repo.slice(repo.indexOf('/') + 1);

/** What happened, in a few words, for a shipping event. */
export function describeEvent(event: ShippingEvent): string {
  switch (event.type) {
    case 'release':
      return `released ${event.tag}`;
    case 'push':
      return `pushed ${plural(event.commits, 'commit', 'commits')}`;
    case 'merge':
      return `merged #${event.number}: ${event.title}`;
    case 'stars':
      return `gained ${plural(event.gained, 'star', 'stars')} (${event.total.toLocaleString('en')} total)`;
  }
}

/** `2026-10-24` from an RFC 3339 timestamp, in UTC. */
export const utcDay = (iso: string) => new Date(iso).toISOString().slice(0, 10);

export const count = (value: number) => value.toLocaleString('en');
