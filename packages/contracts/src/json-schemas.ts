import type { z } from 'zod';
import { anyEnvelopeSchema } from './envelope.ts';
import { listeningSnapshotSchema } from './snapshots/listening.ts';
import { projectsSnapshotSchema } from './snapshots/projects.ts';
import { repoPulseFeedSchema, shippingSnapshotSchema } from './snapshots/shipping.ts';

/** Schemas exported as JSON Schema to `schema/<name>.{input,output}.json` for other languages. */
export const jsonSchemas: Readonly<Record<string, z.ZodType>> = {
  envelope: anyEnvelopeSchema,
  // `data` of each read API envelope.
  listening: listeningSnapshotSchema,
  shipping: shippingSnapshotSchema,
  projects: projectsSnapshotSchema,
  // What repo-pulse serves on GET /public/feed (ADR 0012).
  'repo-pulse-feed': repoPulseFeedSchema,
};
