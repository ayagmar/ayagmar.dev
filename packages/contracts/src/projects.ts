import { z } from 'zod';

/** `owner/name` of a GitHub repository. */
export const repoFullNameSchema = z
  .string()
  .max(140)
  .regex(/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/);

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
});

/**
 * The featured projects, in display order: what signals fetches from GitHub and npm and what
 * the site links posts to. Identifiers only; descriptions come from GitHub. A slug stays the
 * same when the repository is renamed.
 */
export const featuredProjects = [
  { slug: 'llm-usage-metrics', repo: 'ayagmar/llm-usage-metrics', npmPackage: 'llm-usage-metrics' },
  { slug: 'ccdesk', repo: 'ayagmar/ccdesk', npmPackage: 'ccdesk' },
  { slug: 'pi-mobile', repo: 'ayagmar/pi-mobile' },
  { slug: 'pi-extmgr', repo: 'ayagmar/pi-extmgr', npmPackage: 'pi-extmgr' },
  { slug: 'runnerd', repo: 'ayagmar/runnerd' },
  { slug: 'kipple', repo: 'ayagmar/kipple' },
  { slug: 'niri-computer-use', repo: 'ayagmar/niri-computer-use' },
  { slug: 'headroom', repo: 'ayagmar/headroom' },
] as const satisfies readonly FeaturedProject[];

export type FeaturedProject = z.infer<typeof featuredProjectSchema>;

export type ProjectSlug = (typeof featuredProjects)[number]['slug'];

const slugs: ReadonlySet<string> = new Set(featuredProjects.map((project) => project.slug));

export const isProjectSlug = (value: string): value is ProjectSlug => slugs.has(value);
