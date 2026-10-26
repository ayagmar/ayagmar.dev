import { z } from 'astro/zod';
import { artKinds, artPalettes } from './art.ts';
import { projectSlug } from './project-schema.ts';

const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const slugMessage = 'must be a lowercase slug like "rust" or "home-lab"';
const dateMessage = 'must be a date like 2026-10-26';

// YAML reads an unquoted 2026-10-26 as a Date; a quoted one stays a string and must be a real
// calendar day. Nothing else is coerced, so a blank `date:` (null) fails instead of becoming 1970.
type Palette = keyof typeof artPalettes;
const palettes = Object.keys(artPalettes) as [Palette, ...Palette[]];

/** Optional art above the title (ADR 0027): drawn at build time from the slug and `seed`. */
const art = z.strictObject({
  kind: z.enum(artKinds, { error: `must be one of ${artKinds.join(', ')}` }),
  seed: z.number({ error: 'must be a whole number' }).int().nonnegative().default(0),
  palette: z.enum(palettes, { error: `must be one of ${palettes.join(', ')}` }).default('night'),
});

export const day = z.union([z.date(), z.iso.date().transform((text) => new Date(text))], {
  error: dateMessage,
});

/** The tag vocabulary posts and TIL notes share: lowercase slugs, none twice. */
export const tagList = z
  .array(z.string().regex(slug, slugMessage), { error: 'must be a list of tags' })
  .refine((tags) => new Set(tags).size === tags.length, 'must not repeat a tag')
  .default([]);

/** Frontmatter of a post in content/writing. Unknown fields are rejected to catch typos. */
export const writingSchema = z
  .strictObject({
    title: z.string({ error: 'is required' }).trim().min(1, 'must not be empty'),
    date: day,
    updated: day.optional(),
    summary: z.string({ error: 'is required' }).trim().min(1, 'must not be empty'),
    tags: tagList,
    series: z.string().regex(slug, slugMessage).optional(),
    draft: z.boolean({ error: 'must be true or false' }).default(false),
    /** Slugs of the featured projects the post is about. */
    projects: z
      .array(projectSlug, { error: 'must be a list of project slugs' })
      .refine((slugs) => new Set(slugs).size === slugs.length, 'must not repeat a project')
      .default([]),
    art: art.optional(),
  })
  .refine((post) => post.updated === undefined || post.updated >= post.date, {
    path: ['updated'],
    message: 'must not be before date',
  });

export type WritingFrontmatter = z.output<typeof writingSchema>;
