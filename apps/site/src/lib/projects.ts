import {
  featuredProjects,
  type Project,
  type ProjectEventsSnapshot,
  type ProjectSlug,
} from '@min7/contracts';
import { plural } from './plural.ts';
import { type ProjectFrontmatter, type ProjectGroup, projectGroups } from './project-schema.ts';
import type { Post } from './writing.ts';

/**
 * A featured project as every page renders it: the registry entry from contracts, the owner's
 * content/projects/<slug>.md if there is one, and the live numbers from the projects snapshot
 * if signals had them. The slug is the project's name on the site; it never changes.
 */
export interface SiteProject {
  slug: ProjectSlug;
  /** `owner/name`, as GitHub reports it now when the snapshot has it. */
  repo: string;
  repoUrl: string;
  /** The tagline from the project file, else the GitHub description. */
  summary: string | null;
  /** From the project file, else `archived` when GitHub says so, else unknown. */
  status: ProjectFrontmatter['status'] | null;
  /** From the project file; null without one. */
  group: ProjectGroup | null;
  /** Whether signals fetches its numbers; false for `pull: false` in contracts. */
  pulled: boolean;
  /** The command that installs or runs it, from the project file; null without one. */
  install: string | null;
  /** `https://<subdomain>.ayagmar.dev` when the project has its own site. */
  homepage: string | null;
  npmUrl: string | null;
  /** The snapshot entry; null when signals has no data for this project. */
  live: Project | null;
}

export const projectPath = (slug: ProjectSlug) => `/projects/${slug}`;

/**
 * Every featured project, in display order: `order` from its file first (lower first), then
 * the contracts order. `files` are the parsed content/projects files; `live` the snapshot list.
 */
export function siteProjects(
  files: readonly ProjectFrontmatter[],
  live: readonly Project[] | null
): SiteProject[] {
  const rank = (slug: string) =>
    files.find((file) => file.slug === slug)?.order ?? Number.POSITIVE_INFINITY;
  return featuredProjects
    .map((entry, index) => ({ entry, index }))
    .toSorted((a, b) => rank(a.entry.slug) - rank(b.entry.slug) || a.index - b.index)
    .map(({ entry }) => {
      const file = files.find((candidate) => candidate.slug === entry.slug);
      const stats = live?.find((project) => project.slug === entry.slug) ?? null;
      const repo = stats?.repo ?? entry.repo;
      return {
        slug: entry.slug,
        repo,
        repoUrl: stats?.url ?? `https://github.com/${repo}`,
        summary: file?.tagline ?? stats?.description ?? null,
        status: file?.status ?? (stats?.archived === true ? 'archived' : null),
        group: file?.group ?? null,
        pulled: !('pull' in entry),
        install: file?.install ?? null,
        homepage: file?.subdomain === undefined ? null : `https://${file.subdomain}.ayagmar.dev`,
        npmUrl: 'npmPackage' in entry ? `https://www.npmjs.com/package/${entry.npmPackage}` : null,
        live: stats,
      };
    });
}

/**
 * The projects under their group headings, each group where its first project ranks and the
 * projects in rank order. Projects without a file come last, under "Other".
 */
export function projectsByGroup<P extends Pick<SiteProject, 'group'>>(projects: readonly P[]) {
  const groups = new Map<ProjectGroup | null, P[]>();
  for (const project of projects.filter((p) => p.group !== null)) {
    groups.set(project.group, [...(groups.get(project.group) ?? []), project]);
  }
  const other = projects.filter((project) => project.group === null);
  if (other.length > 0) groups.set(null, other);
  return [...groups].map(([id, members]) => ({
    id: id ?? 'other',
    title: id === null ? 'Other' : projectGroups[id],
    projects: members,
  }));
}

/**
 * Whether a project has published a release: yes when the snapshot or the log names one, no when
 * the log has the project and names none (it keeps the newest releases however old, ADR 0046),
 * else what the snapshot says. Null when neither has the project, so a failed pull never claims
 * there is no release.
 */
export function hasReleased(
  { slug, live }: Pick<SiteProject, 'slug' | 'live'>,
  log: ProjectEventsSnapshot | null
): boolean | null {
  if (live?.latestRelease != null) return true;
  const entry = log?.projects.find((project) => project.slug === slug);
  if (entry !== undefined) return entry.events.some((event) => event.type === 'release');
  return live === null ? null : false;
}

/** A link under a project's title; `lead` is plain text before it. */
export interface ProjectLink {
  href: string;
  label: string;
  lead?: string;
}

/**
 * Where to get a project: its source, its npm package and its own site. `released` is
 * `hasReleased`'s answer; only a known "no" says there is no release yet.
 */
export const projectLinks = (
  { repoUrl, homepage, npmUrl }: Pick<SiteProject, 'repoUrl' | 'homepage' | 'npmUrl'>,
  released: boolean | null = null
): ProjectLink[] => [
  released === false
    ? { lead: 'No release yet: ', label: 'build from source', href: repoUrl }
    : { label: 'Source on GitHub', href: repoUrl },
  ...(npmUrl === null ? [] : [{ href: npmUrl, label: 'npm package' }]),
  ...(homepage === null ? [] : [{ href: homepage, label: new URL(homepage).host }]),
];

/** GitHub's Atom feed of the repository's releases, for a project that has published one. */
export const releasesFeed = (
  { repoUrl }: Pick<SiteProject, 'repoUrl'>,
  released: boolean | null
) => (released === true ? `${repoUrl}/releases.atom` : null);

/** The project after `slug` in /projects order, the first after the last; none when it is alone. */
export function nextProject<P extends Pick<SiteProject, 'slug' | 'group'>>(
  projects: readonly P[],
  slug: ProjectSlug
): P | undefined {
  const order = projectsByGroup(projects).flatMap((group) => group.projects);
  const index = order.findIndex((project) => project.slug === slug);
  return index === -1 || order.length < 2 ? undefined : order[(index + 1) % order.length];
}

/** The posts about one project, in the order given (newest first for the published set). */
export const postsAbout = <P extends Post>(posts: readonly P[], slug: ProjectSlug): P[] =>
  posts.filter((post) => post.data.projects.includes(slug));

/** "More on <project>" for a post: the project's other posts, newest first, at most `limit`. */
export const morePostsAbout = <P extends Post>(
  posts: readonly P[],
  slug: ProjectSlug,
  currentId: string,
  limit = 3
): P[] =>
  postsAbout(posts, slug)
    .filter((post) => post.id !== currentId)
    .slice(0, limit);

/** `2 posts`; nothing at all for none, so a project's row says only what it has. */
export const postCount = (count: number) => (count === 0 ? '' : plural(count, 'post', 'posts'));

/** A project's row on /projects and its text copy: `2 posts, active`, or only what it has. */
export const projectRowLabel = <P extends Post>(project: SiteProject, posts: readonly P[]) =>
  [postCount(postsAbout(posts, project.slug).length), project.status].filter(Boolean).join(', ');

/**
 * Problems with the content/projects files, by file id (the file name without `.md`): a slug
 * that differs from its file name fails the build; registered projects without a file are
 * listed so the build can warn about them.
 */
export function checkProjectFiles(files: readonly { id: string; slug: string }[]): {
  errors: string[];
  missing: string[];
} {
  const errors = files
    .filter((file) => file.id !== file.slug)
    .map(
      (file) =>
        `content/projects/${file.id}.md: slug "${file.slug}" must match the file name (${file.id})`
    );
  const present = new Set(files.map((file) => file.slug));
  const missing = featuredProjects.map((entry) => entry.slug).filter((slug) => !present.has(slug));
  return { errors, missing };
}
