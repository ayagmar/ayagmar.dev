import { z } from 'astro/zod';

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
 * Frontmatter of content/now.md (ADR 0035). `updated` is a quoted `YYYY-MM-DD` string: YAML turns
 * an unquoted 2026-02-30 into 2 March before any schema runs, so only the quoted text can be checked
 * as a calendar day. It may not be after the day of `built`, so a typo such as 2062 fails the build
 * instead of making the page look permanently fresh. Unknown
 * fields are rejected to catch typos.
 */
export const nowSchema = (built: Date) =>
  z.strictObject({
    updated: z
      .string({ error: 'must be a quoted day like "2026-10-30"' })
      .pipe(z.iso.date({ error: 'must be a real day like "2026-10-30"', abort: true }))
      .refine((day) => day <= built.toISOString().slice(0, 10), {
        message: 'must not be in the future',
      })
      .transform((day) => new Date(day)),
    brewing: z.array(item, { error: 'must be a list of items' }).default([]),
  });

export type BrewingItem = z.output<typeof item>;
