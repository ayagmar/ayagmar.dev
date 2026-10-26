import { z } from 'astro/zod';

const text = z.string({ error: 'is required' }).trim().min(1, 'must not be empty');

/**
 * content/uses.json: the hand-kept part of /uses. Hardware is written down rather than read
 * from the machines, which would need code to keep serials and paths out of values that change
 * once in years (ADR 0032). Unknown fields are rejected to catch typos.
 */
export const usesSchema = z.strictObject({
  intro: text,
  sections: z
    .array(
      z.strictObject({
        title: text,
        items: z
          .array(z.strictObject({ name: text, detail: text.optional() }))
          .min(1, 'must list at least one item'),
      })
    )
    .min(1, 'must have at least one section'),
  /** Each computer with its parts, in the order shown. */
  machines: z
    .array(
      z.strictObject({
        name: text,
        model: text.optional(),
        specs: z
          .array(z.strictObject({ part: text, value: text }))
          .min(1, 'must list at least one part'),
      })
    )
    .min(1, 'must list at least one machine'),
});
