import { featuredProjects, type Project, type ProjectSlug } from '@min7/contracts';
import type { ProjectFrontmatter } from './project-schema.ts';
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
        homepage: file?.subdomain === undefined ? null : `https://${file.subdomain}.ayagmar.dev`,
        npmUrl: 'npmPackage' in entry ? `https://www.npmjs.com/package/${entry.npmPackage}` : null,
        live: stats,
      };
    });
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

/** `2 posts`, `no posts`. */
export const postCount = (count: number) =>
  count === 0 ? 'no posts' : `${count} ${count === 1 ? 'post' : 'posts'}`;

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
