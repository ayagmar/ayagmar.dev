/**
 * Which `/v1/shipping` and `/v1/projects` data /stats may show when its script reads them in
 * the browser (ADR 0015), checked as the contract states it. The browser does not load the
 * contracts' zod schemas; test/stats.test.ts holds these readers to them.
 */
import type { ProjectsSnapshot, ShippingSnapshot } from '@min7/contracts';
import { instantMs, list, text, whole } from './live.ts';

const repo = (value: unknown) =>
  typeof value === 'string' && /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/.test(value);
const github = (value: unknown) => text(value, 2048) && /^https:\/\/github\.com\/\S*$/.test(value);
/** A calendar date, `2026-10-24`. */
const date = (value: unknown) =>
  typeof value === 'string' && value.length === 10 && instantMs(`${value}T00:00:00Z`) !== undefined;

function event(value: unknown) {
  const { type, repo: name, at, url, tag, gained, total, commits, number, title } = Object(value);
  if (!repo(name) || instantMs(at, true) === undefined) return false;
  switch (type) {
    case 'release':
      return github(url) && text(tag);
    case 'stars':
      return whole(gained, 1) && whole(total);
    case 'push':
      return github(url) && whole(commits);
    case 'merge':
      return github(url) && whole(number, 1) && text(title);
  }
  return false;
}

/** `data` if it is a shipping snapshot, else undefined. */
export function readShipping(data: unknown): ShippingSnapshot | undefined {
  const { events, starHistory } = Object(data);
  return list(events, 50, event) &&
    list(starHistory, 50, (item) => {
      const { repo: name, points } = Object(item);
      return (
        repo(name) &&
        list(points, 90, (point) => {
          const { date: day, stars } = Object(point);
          return date(day) && whole(stars);
        })
      );
    })
    ? (data as ShippingSnapshot)
    : undefined;
}

/**
 * `data` if it is a projects snapshot whose star counts /stats can add up, else undefined.
 * Only what the page shows is checked: how many projects, and each one's stars.
 */
export function readProjects(data: unknown): ProjectsSnapshot | undefined {
  return list(Object(data).projects, 30, (project) => {
    const { stars } = Object(project);
    return stars === null || whole(stars);
  })
    ? (data as ProjectsSnapshot)
    : undefined;
}

/** The words /stats shows around the numbers, at build time and live. */
export const statsWords = {
  thisWeek: 'Scrobbles this week',
  lastWeek: 'Scrobbles last week',
  recent: 'Recent tracks',
  noRecent: 'No scrobbles yet.',
  top: 'Top artists',
  noTop: 'No top artists yet.',
  noShipping: 'No public activity to show yet.',
  stars: 'Stars',
  noProjects: 'No project data yet.',
};

/** A week's scrobbles, or `unknown` when Last.fm did not answer that part. */
export const weekCount = (scrobbles: number | null) =>
  scrobbles === null ? 'unknown' : scrobbles.toLocaleString('en');

/** The latest star count of each repository, for the Stars list. */
export const starTotals = ({ starHistory }: ShippingSnapshot) =>
  starHistory.flatMap(({ repo, points }) => {
    const last = points.at(-1);
    return last === undefined ? [] : [{ repo, stars: last.stars, date: last.date }];
  });
