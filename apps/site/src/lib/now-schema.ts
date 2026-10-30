import { z } from 'astro/zod';
import { day } from './writing-schema.ts';

const text = (max: number) =>
  z
    .string({ error: 'is required' })
    .trim()
    .min(1, 'must not be empty')
    .max(max, `must be at most ${max} characters`);

const item = z.strictObject({
  name: text(60),
  note: text(240),
  url: z.url({ protocol: /^https$/, error: 'must be an https:// URL' }).optional(),
});

/**
 * Frontmatter of content/now.md (ADR 0035). `updated` may not be after the day of `built`, so a
 * typo such as 2062 fails the build instead of making the page look permanently fresh. Unknown
 * fields are rejected to catch typos.
 */
export const nowSchema = (built: Date) =>
  z.strictObject({
    updated: day.refine(
      (date) => date.toISOString().slice(0, 10) <= built.toISOString().slice(0, 10),
      {
        message: 'must not be in the future',
      }
    ),
    brewing: z.array(item, { error: 'must be a list of items' }).default([]),
  });

export type BrewingItem = z.output<typeof item>;
