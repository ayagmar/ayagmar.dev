import { featuredProjects, isProjectSlug } from '@min7/contracts';
import { z } from 'astro/zod';

const registered = featuredProjects.map((project) => project.slug).join(', ');

/** A slug from `featuredProjects` in packages/contracts/src/projects.ts; the error names it. */
export const projectSlug = z.string().refine(isProjectSlug, {
  error: (issue) =>
    `"${String(issue.input)}" is not a featured project in packages/contracts/src/projects.ts (one of: ${registered})`,
});

const projectStatuses = ['active', 'maintained', 'archived', 'spec'] as const;

/** Frontmatter of content/projects/<slug>.md; the Markdown body is the long description. */
export const projectSchema = z.strictObject({
  slug: projectSlug,
  tagline: z.string().trim().min(1, 'must not be empty').optional(),
  status: z.enum(projectStatuses, { error: `must be one of ${projectStatuses.join(', ')}` }),
  /** The project's own site, `<subdomain>.ayagmar.dev`. */
  subdomain: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be a label like "ccdesk", without ".ayagmar.dev"')
    .optional(),
  /** Sorts the project list; lower first, projects without it after, in the contracts order. */
  order: z.number({ error: 'must be a whole number' }).int('must be a whole number').optional(),
});

export type ProjectFrontmatter = z.output<typeof projectSchema>;
