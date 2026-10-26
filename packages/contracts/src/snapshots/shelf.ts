import { z } from 'zod';
import { envelopeSchema } from '../envelope.ts';
import { dayCountSchema } from '../push/delivery.ts';
import { mediaKinds } from '../push/trellis.ts';

/** `/v1/shelf`: what the owner is reading and watching, and habit streaks. */
export const shelfSnapshotSchema = z.object({
  booksFinished: z.object({ year: z.int(), count: z.int().min(0) }),
  inProgress: z.array(
    z.object({
      title: z.string().min(1),
      kind: z.enum(mediaKinds),
      progress: z.object({ current: z.int().min(0), total: z.int().min(1).nullable() }),
    })
  ),
  /** Public habit names, longest streak first. */
  habits: z.array(z.object({ habit: z.string().min(1).max(64), streakDays: dayCountSchema })),
});

export type ShelfSnapshot = z.infer<typeof shelfSnapshotSchema>;

export const shelfEnvelopeSchema = envelopeSchema(z.literal('shelf'), shelfSnapshotSchema);
