// Each featured project's latest releases and merged pull requests, from one GitHub GraphQL
// request for all of them (ADR 0046).
import {
  featuredProjects,
  type GithubMergedPull,
  type GithubProjectRepo,
  type GithubReleaseNode,
  githubGraphqlAnswerSchema,
  githubGraphqlErrorSchema,
  githubOwner,
  githubProjectRepoSchema,
  type ProjectEvent,
  type ProjectEventsSnapshot,
  projectEventsSnapshotSchema,
  projectMergesAsked,
  projectMergesKept,
  projectReleasesKept,
  timestampPattern,
} from '@min7/contracts';
import { rabatDate, rabatDayStart } from '@min7/contracts/rabat';
import type { PullAdapter } from '../types.ts';
import { checkSnapshot, getJson, PullError, parseBody, type UpstreamResponse } from './http.ts';
import { readSecret } from './secrets.ts';
import { midnightYieldMs } from './shipping-activity.ts';

const endpoint = 'https://api.github.com/graphql';
// The answer for 14 projects was 58 KB on 2026-11-11, and about 190 KB with every title and tag
// at its longest; 30 projects, the snapshot's limit, would be about 400 KB.
const maxBytes = 512 * 1024;
const intervalMs = 60 * 60 * 1000;

/** A project's alias in the query. GraphQL names allow no hyphen, and slugs have no underscore. */
export const projectAlias = (slug: string) => `p_${slug.replaceAll('-', '_')}`;

const fields = [
  'nameWithOwner',
  'isPrivate',
  `releases(first: ${projectReleasesKept}, orderBy: {field: CREATED_AT, direction: DESC})`,
  '{ nodes { tagName url createdAt publishedAt } }',
  `pullRequests(states: MERGED, first: ${projectMergesAsked}, orderBy: {field: UPDATED_AT, direction: DESC})`,
  '{ nodes { number title url mergedAt updatedAt author { login } } }',
].join(' ');

/**
 * Every featured project, `pull: false` ones included: here a repository is one more alias, not
 * more subrequests. Names match `repoFullNamePattern`, so none can leave its string.
 */
const projectEventsQuery = `query { ${featuredProjects
  .map(({ slug, repo }) => {
    const [owner, name] = repo.split('/');
    return `${projectAlias(slug)}: repository(owner: "${owner}", name: "${name}") { ...log }`;
  })
  .join(' ')} } fragment log on Repository { ${fields} }`;

/**
 * Authors whose pull requests are left out of the log: dependency updates, not work. GraphQL
 * names a bot without `[bot]`, REST and the web with it.
 */
const dependencyBots = new Set(['dependabot', 'dependabot[bot]', 'renovate', 'renovate[bot]']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length >= 1 && value.length <= max;

const isTimestamp = (value: unknown): value is string =>
  typeof value === 'string' && timestampPattern.test(value);

const isGithubUrl = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length <= 2048 &&
  /^https:\/\/github\.com\/[^\s]*$/.test(value);

/**
 * A release node as `githubReleaseNodeSchema` reads it, unknown keys dropped, or null. Written
 * out because zod per node costs milliseconds in workerd (ADR 0046);
 * `test/pull-normalize.test.ts` holds it to the schema.
 */
export function readReleaseNode(value: unknown): GithubReleaseNode | null {
  if (!isRecord(value)) return null;
  const { tagName, url, createdAt, publishedAt } = value;
  if (!isText(tagName, 200) || !isGithubUrl(url) || !isTimestamp(createdAt)) return null;
  if (publishedAt !== null && !isTimestamp(publishedAt)) return null;
  return { tagName, url, createdAt, publishedAt };
}

/** A merged pull request node as `githubMergedPullSchema` reads it, or null; as above. */
export function readMergedPull(value: unknown): GithubMergedPull | null {
  if (!isRecord(value)) return null;
  const { number, title, url, mergedAt, updatedAt, author } = value;
  if (typeof number !== 'number' || !Number.isSafeInteger(number) || number <= 0) return null;
  if (!isText(title, 300) || !isGithubUrl(url)) return null;
  if (!isTimestamp(mergedAt) || !isTimestamp(updatedAt)) return null;
  if (author === null) return { number, title, url, mergedAt, updatedAt, author };
  if (!isRecord(author) || !isText(author.login, 100)) return null;
  return { number, title, url, mergedAt, updatedAt, author: { login: author.login } };
}

/**
 * The nodes of a connection that are no older than its frontier. GitHub orders the page by
 * `order` (update or creation time), not by the time the log shows, so a full page holds every
 * event since the oldest `order` in it and only a few before: those are dropped, so the log can
 * be shorter but never skips one. A page shorter than asked is everything there is.
 */
function sinceFrontier<T>(
  page: readonly unknown[],
  read: (value: unknown) => T | null,
  order: (node: T) => string,
  at: (node: T) => string,
  asked: number
): T[] {
  const nodes = page.map(read).filter((node) => node !== null);
  if (page.length < asked) return nodes;
  const frontier = Math.min(...nodes.map((node) => Date.parse(order(node))));
  return nodes.filter((node) => Date.parse(at(node)) >= frontier);
}

const newestFirst = (a: ProjectEvent, b: ProjectEvent) =>
  Date.parse(b.at) - Date.parse(a.at) || (a.url < b.url ? -1 : a.url > b.url ? 1 : 0);

/** The newest `count` of `events`, each URL once. */
function newest(events: ProjectEvent[], count: number): ProjectEvent[] {
  const seen = new Set<string>();
  const kept: ProjectEvent[] = [];
  for (const event of events.sort(newestFirst)) {
    if (seen.has(event.url)) continue;
    seen.add(event.url);
    kept.push(event);
  }
  return kept.slice(0, count);
}

/** A project's log: its newest releases and merges, each kind cut on its own, newest first. */
function projectLog(repo: GithubProjectRepo): ProjectEvent[] {
  const name = repo.nameWithOwner;
  const releases = sinceFrontier(
    repo.releases.nodes,
    readReleaseNode,
    (node) => node.createdAt,
    (node) => node.publishedAt ?? node.createdAt,
    projectReleasesKept
  ).flatMap((node): ProjectEvent[] =>
    node.publishedAt === null
      ? []
      : [{ type: 'release', repo: name, at: node.publishedAt, url: node.url, tag: node.tagName }]
  );
  const merges = sinceFrontier(
    repo.pullRequests.nodes,
    readMergedPull,
    (node) => node.updatedAt,
    (node) => node.mergedAt,
    projectMergesAsked
  ).flatMap((node): ProjectEvent[] =>
    node.author !== null && dependencyBots.has(node.author.login.toLowerCase())
      ? []
      : [
          {
            type: 'merge',
            repo: name,
            at: node.mergedAt,
            url: node.url,
            number: node.number,
            title: node.title,
          },
        ]
  );
  return [...newest(releases, projectReleasesKept), ...newest(merges, projectMergesKept)].sort(
    newestFirst
  );
}

export const projectEvents: PullAdapter<UpstreamResponse, ProjectEventsSnapshot> = {
  id: 'project-events',
  // Hourly, one request: a release or merge shows within the hour, for 24 of the token's 5,000
  // GraphQL points an hour.
  intervalSeconds: intervalMs / 1000,

  /** An hour after the last attempt, never in the first minutes of a date in Rabat (ADR 0030). */
  dueAt(status) {
    const due = (status.lastAttemptAt ?? 0) + intervalMs;
    return Math.max(due, rabatDayStart(rabatDate(due)) * 1000 + midnightYieldMs);
  },

  async fetch(env, signal) {
    // GitHub's GraphQL API answers no anonymous request. Public data only: the token reads no
    // private repository, and it goes to this host alone, never through a redirect.
    const token = readSecret(env, 'GITHUB_TOKEN');
    if (token === undefined) throw new PullError('not_configured');
    return getJson(endpoint, {
      signal,
      maxBytes,
      redirect: 'manual',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
      },
      json: { query: projectEventsQuery },
    });
  },

  /**
   * One entry per featured project GitHub answered as public and the owner's. A repository it
   * says does not exist (`NOT_FOUND`: deleted, or private to a token that reads public data
   * only), one it calls private and one moved to another account are left out. Any other
   * repository without an answer fails the whole pull, so a passing GitHub error never reads
   * as a repository gone private and empties a log the next site build would keep (ADR 0046).
   */
  normalize(raw) {
    if (raw.status === 401) throw new PullError('upstream_unauthorized');
    const answer = parseBody(raw, githubGraphqlAnswerSchema);
    const errors = (answer.errors ?? []).flatMap((item) => {
      const parsed = githubGraphqlErrorSchema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    });
    const data = answer.data;
    if (data == null) {
      if (errors.some((error) => error.type === 'RATE_LIMITED')) {
        throw new PullError('upstream_rate_limited', raw.retryAt);
      }
      throw new PullError('upstream_error');
    }
    const missing = new Set(
      errors.flatMap((error) =>
        error.type === 'NOT_FOUND' && error.path?.length === 1 ? [String(error.path[0])] : []
      )
    );
    const projects: ProjectEventsSnapshot['projects'] = [];
    for (const { slug } of featuredProjects) {
      const alias = projectAlias(slug);
      const value = data[alias];
      if (value === null && missing.has(alias)) continue;
      if (value == null) throw new PullError('upstream_error');
      const repo = githubProjectRepoSchema.safeParse(value);
      if (!repo.success) throw new PullError('upstream_malformed');
      const { nameWithOwner, isPrivate } = repo.data;
      if (isPrivate || !nameWithOwner.startsWith(`${githubOwner}/`)) continue;
      projects.push({ slug, repo: nameWithOwner, events: projectLog(repo.data) });
    }
    return checkSnapshot(projectEventsSnapshotSchema, { projects });
  },
};
