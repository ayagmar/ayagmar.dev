import { z } from 'zod';
import { envelopeSchema } from '../envelope.ts';
import { bootedAtSchema, kernelReleaseSchema, niriVersionSchema } from '../push/desktop.ts';

/**
 * `/v1/desktop`: the owner's desktop as its producer last reported it (ADR 0032). The site
 * derives uptime from `bootedAt`; nothing here says the machine is on now.
 */
export const desktopSnapshotSchema = z.object({
  kernel: kernelReleaseSchema.nullable(),
  niri: niriVersionSchema.nullable(),
  bootedAt: bootedAtSchema,
});

export type DesktopSnapshot = z.infer<typeof desktopSnapshotSchema>;

/** The `/v1/desktop` response. */
export const desktopEnvelopeSchema = envelopeSchema(z.literal('desktop'), desktopSnapshotSchema);
