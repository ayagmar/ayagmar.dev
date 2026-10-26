import { z } from 'astro/zod';
import { day, tagList } from './writing-schema.ts';

/** Frontmatter of a note in content/til. Unknown fields are rejected to catch typos. */
export const tilSchema = z.strictObject({
  title: z.string({ error: 'is required' }).trim().min(1, 'must not be empty'),
  date: day,
  tags: tagList,
  draft: z.boolean({ error: 'must be true or false' }).default(false),
});

export type TilFrontmatter = z.output<typeof tilSchema>;
