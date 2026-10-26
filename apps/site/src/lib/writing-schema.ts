import { z } from 'astro/zod';

const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const slugMessage = 'must be a lowercase slug like "rust" or "home-lab"';
const dateMessage = 'must be a date like 2026-10-26';

/** Frontmatter of a post in content/writing. Unknown fields are rejected to catch typos. */
export const writingSchema = z
  .strictObject({
    title: z.string({ error: 'is required' }).trim().min(1, 'must not be empty'),
    date: z.coerce.date({ error: dateMessage }),
    updated: z.coerce.date({ error: dateMessage }).optional(),
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
