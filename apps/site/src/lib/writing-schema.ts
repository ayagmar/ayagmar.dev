import { z } from 'astro/zod';

const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const slugMessage = 'must be a lowercase slug like "rust" or "home-lab"';
const dateMessage = 'must be a date like 2026-10-26';

// YAML reads an unquoted 2026-10-26 as a Date; a quoted one stays a string and must be a real
// calendar day. Nothing else is coerced, so a blank `date:` (null) fails instead of becoming 1970.
const day = z.union([z.date(), z.iso.date().transform((text) => new Date(text))], {
  error: dateMessage,
});

/** Frontmatter of a post in content/writing. Unknown fields are rejected to catch typos. */
export const writingSchema = z
  .strictObject({
    title: z.string({ error: 'is required' }).trim().min(1, 'must not be empty'),
    date: day,
    updated: day.optional(),
    summary: z.string({ error: 'is required' }).trim().min(1, 'must not be empty'),
    tags: z
      .array(z.string().regex(slug, slugMessage), { error: 'must be a list of tags' })
      .refine((tags) => new Set(tags).size === tags.length, 'must not repeat a tag')
      .default([]),
    series: z.string().regex(slug, slugMessage).optional(),
    draft: z.boolean({ error: 'must be true or false' }).default(false),
  })
  .refine((post) => post.updated === undefined || post.updated >= post.date, {
    path: ['updated'],
    message: 'must not be before date',
  });

export type WritingFrontmatter = z.output<typeof writingSchema>;
