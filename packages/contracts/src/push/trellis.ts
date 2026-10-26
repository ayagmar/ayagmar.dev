import { z } from 'zod';
import { dayCountSchema, pushDeliverySchema } from './delivery.ts';

export const mediaKinds = ['anime', 'manga', 'light-novel', 'book'] as const;

/** A public title: no control characters, so it renders as one line anywhere. */
const titleSchema = z
  .string()
  .min(1)
  .max(200)
  // biome-ignore lint/suspicious/noControlCharactersInRegex: the class exists to reject them.
  .regex(/^[^\u0000-\u001F\u007F]+$/);

/**
 * What trellis pushes: an allowlisted public summary only (ADR 0013). `habit` is a trellis
 * habit id; signals publishes only ids it has a reviewed label for and drops the rest.
 */
export const trellisPushPayloadSchema = z.object({
  booksFinished: z.object({
    year: z.int().min(2000).max(2100),
    count: z.int().min(0).max(10_000),
  }),
  inProgress: z
    .array(
      z.object({
        title: titleSchema,
        kind: z.enum(mediaKinds),
        progress: z.object({
          current: z.int().min(0).max(100_000),
          /** Null while the total is unknown, such as a running series. */
          total: z.int().min(1).max(100_000).nullable(),
        }),
      })
    )
    .max(50),
  habits: z
    .array(z.object({ habit: z.string().min(1).max(128), streakDays: dayCountSchema }))
    .max(50),
});

export const trellisPushSchema = pushDeliverySchema('trellis', trellisPushPayloadSchema);

export type TrellisPush = z.infer<typeof trellisPushSchema>;
