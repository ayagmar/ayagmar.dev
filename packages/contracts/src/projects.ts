import { z } from 'zod';

/** The GitHub account whose repositories the site shows. */
export const githubOwner = 'ayagmar';

/** `owner/name` of a GitHub repository, for code that checks it without zod. */
export const repoFullNamePattern = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;

/** `owner/name` of a GitHub repository. */
export const repoFullNameSchema = z.string().max(140).regex(repoFullNamePattern);

/** An npm package name, scoped or not. */
export const npmPackageNameSchema = z
  .string()
  .max(214)
  .regex(/^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/);

/** A project's id in URLs and content: lowercase words joined by hyphens. Never renamed. */
export const projectSlugSchema = z
  .string()
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const featuredProjectSchema = z.object({
  slug: projectSlugSchema,
  repo: repoFullNameSchema,
  /** The npm package published from the repository, if any. */
  npmPackage: npmPackageNameSchema.optional(),
  /**
   * `false`: the projects pull asks GitHub and npm nothing about it, so it stays within Workers
   * Free's 50 subrequests (ADR 0009). For a project whose releases or packages say nothing
   * about the repository as a whole (agents-skills publishes one per skill), or that has
   * neither. Its log is still pulled: that is one request for every project (ADR 0046).
   */
  pull: z.literal(false).optional(),
});

/**
 * The featured projects, strongest first: what the site lists and links posts to, whose
 * releases and merges signals fetches for their logs, and, unless `pull: false`, whose numbers
 * it fetches from GitHub and npm. Identifiers only; descriptions are
 * in content/projects. A slug stays the same when the repository is renamed.
 */
export const featuredProjects = [
  { slug: 'llm-usage-metrics', repo: 'ayagmar/llm-usage-metrics', npmPackage: 'llm-usage-metrics' },
  { slug: 'pi-mobile', repo: 'ayagmar/pi-mobile' },
  { slug: 'pi-extmgr', repo: 'ayagmar/pi-extmgr', npmPackage: 'pi-extmgr' },
  { slug: 'ccdesk', repo: 'ayagmar/ccdesk', npmPackage: 'ccdesk' },
  { slug: 'niri-computer-use', repo: 'ayagmar/niri-computer-use' },
  { slug: 'runnerd', repo: 'ayagmar/runnerd' },
  {
    slug: 'pi-codex-web-search',
    repo: 'ayagmar/pi-codex-web-search',
    npmPackage: 'pi-codex-web-search',
  },
  { slug: 'pi-promptsmith', repo: 'ayagmar/pi-promptsmith', npmPackage: 'pi-promptsmith' },
  { slug: 'claude-modmgr', repo: 'ayagmar/claude-modmgr' },
  { slug: 'repo-pulse', repo: 'ayagmar/repo-pulse' },
  { slug: 'agents-skills', repo: 'ayagmar/agents-skills', pull: false },
  { slug: 'kipple', repo: 'ayagmar/kipple', pull: false },
  { slug: 'dotfiles', repo: 'ayagmar/dotfiles', pull: false },
] as const satisfies readonly FeaturedProject[];

export type FeaturedProject = z.infer<typeof featuredProjectSchema>;

export type ProjectSlug = (typeof featuredProjects)[number]['slug'];

/** The featured projects signals fetches from GitHub and npm, in the same order. */
export const pulledProjects = featuredProjects.filter(
  (project): project is Exclude<(typeof featuredProjects)[number], { pull: false }> =>
    !('pull' in project)
);

const slugs: ReadonlySet<string> = new Set(featuredProjects.map((project) => project.slug));

export const isProjectSlug = (value: string): value is ProjectSlug => slugs.has(value);
