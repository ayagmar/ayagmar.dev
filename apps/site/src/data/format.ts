import type { Project, ShippingEvent } from '@min7/contracts';

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

/** The /stats line about projects. Unknown star counts are never added as zero. */
export function projectsSummary(projects: readonly Pick<Project, 'stars'>[]): string {
  const known = projects.flatMap((project) => (project.stars === null ? [] : [project.stars]));
  const total = count(known.reduce((sum, stars) => sum + stars, 0));
  const missing = projects.length - known.length;
  const head = plural(projects.length, 'featured project', 'featured projects');
  return missing === 0
    ? `${head}, ${total} stars in total.`
    : `${head}, at least ${total} stars; GitHub did not answer for ${missing}.`;
}
