import { z } from 'astro/zod';
import { contentImage } from './content-images.ts';
import { projectSlug } from './project-schema.ts';

const file = contentImage('projects');

/**
 * A screenshot of a project from its own repository (ADR 0049): one `image` for both themes, or a
 * `day` and a `night` version of the same view, which the page swaps with the theme. One object
 * with optional fields rather than a union, so a missing file's error reaches the build output.
 */
const projectScreenshot = z
  .strictObject({
    slug: projectSlug,
    alt: z.string().trim().min(1, 'must say in one sentence what is on screen'),
    image: file.optional(),
    day: file.optional(),
    night: file.optional(),
  })
  .transform(({ slug, alt, image, day, night }, context) => {
    if (image !== undefined && day === undefined && night === undefined) {
      return { slug, alt, day: image, night: image };
    }
    if (image === undefined && day !== undefined && night !== undefined) {
      return { slug, alt, day, night };
    }
    context.addIssue({ code: 'custom', message: 'must have either image, or both day and night' });
    return z.NEVER;
  });

export type ProjectScreenshot = z.output<typeof projectScreenshot>;

/**
 * content/project-screenshots.json. In JSON rather than each project's frontmatter because the
 * formatter reads frontmatter as Markdown and flattens nested YAML.
 */
export const projectScreenshotsSchema = z.object({
  screenshots: z
    .array(projectScreenshot)
    .refine((list) => new Set(list.map(({ slug }) => slug)).size === list.length, {
      error: 'a project is listed twice',
    }),
});
