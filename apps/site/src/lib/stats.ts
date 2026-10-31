/**
 * Which `/v1/shipping` and `/v1/projects` data /stats may show when its script reads them in
 * the browser (ADR 0015), checked whole as the contract states it: an answer that is not a
 * snapshot of featured projects is not counted, whatever star counts it carries. The browser
 * does not load the contracts' zod schemas; test/live.test.ts holds these readers to them.
 */
import type { ProjectsSnapshot, ShippingSnapshot } from '@min7/contracts';
import { calendarDate, instantMs, list, text, whole } from './live.ts';

const repo = (value: unknown) =>
  typeof value === 'string' && /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/.test(value);
const github = (value: unknown) => text(value, 2048) && /^https:\/\/github\.com\/\S*$/.test(value);

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
          return calendarDate(day) && whole(stars);
        })
      );
    })
    ? (data as ShippingSnapshot)
    : undefined;
}

const string = (value: unknown) => value === null || typeof value === 'string';

function project(value: unknown) {
  const {
    slug,
    repo: name,
    name: title,
    url,
    description,
    language,
    stars,
    archived,
  } = Object(value);
  const { latestRelease: release, npm } = Object(value);
  return (
    typeof slug === 'string' &&
    slug.length <= 100 &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) &&
    repo(name) &&
    text(title) &&
    github(url) &&
    string(description) &&
    string(language) &&
    (stars === null || whole(stars)) &&
    (archived === null || typeof archived === 'boolean') &&
    (release === null ||
      (text(Object(release).tag) &&
        github(Object(release).url) &&
        instantMs(Object(release).publishedAt, true) !== undefined)) &&
    (npm === null ||
      (text(Object(npm).package, 214) &&
        /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(Object(npm).package) &&
        (Object(npm).monthlyDownloads === null || whole(Object(npm).monthlyDownloads))))
  );
}

/** `data` if it is a projects snapshot, else undefined. */
export function readProjects(data: unknown): ProjectsSnapshot | undefined {
  return list(Object(data).projects, 30, project) ? (data as ProjectsSnapshot) : undefined;
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
  stars: 'GitHub stars, last counted',
  noProjects: 'No project data yet.',
};

/** A week's scrobbles, or `unknown` when Last.fm did not answer that part. */
export const weekCount = (scrobbles: number | null) =>
  scrobbles === null ? 'unknown' : scrobbles.toLocaleString('en');

/** The latest star count of each repository, most stars first, for the GitHub stars list. */
export const starTotals = ({ starHistory }: ShippingSnapshot) =>
  starHistory
    .flatMap(({ repo, points }) => {
      const last = points.at(-1);
      return last === undefined ? [] : [{ repo, stars: last.stars, date: last.date }];
    })
    .sort((a, b) => b.stars - a.stars);
