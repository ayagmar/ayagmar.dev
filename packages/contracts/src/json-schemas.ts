import type { z } from 'zod';
import { anyEnvelopeSchema } from './envelope.ts';
import { llmUsagePushSchema } from './push/llm-usage.ts';
import { trellisPushSchema } from './push/trellis.ts';
import { listeningSnapshotSchema } from './snapshots/listening.ts';
import { llmUsageEnvelopeSchema } from './snapshots/llm-usage.ts';
import { projectsSnapshotSchema } from './snapshots/projects.ts';
import { shelfEnvelopeSchema } from './snapshots/shelf.ts';
import { repoPulseFeedSchema, shippingSnapshotSchema } from './snapshots/shipping.ts';

/** Schemas exported as JSON Schema to `schema/<name>.{input,output}.json` for other languages. */
export const jsonSchemas: Readonly<Record<string, z.ZodType>> = {
  envelope: anyEnvelopeSchema,
  // `data` of each pulled source's read API envelope.
  listening: listeningSnapshotSchema,
  shipping: shippingSnapshotSchema,
  projects: projectsSnapshotSchema,
  // What repo-pulse serves on GET /public/feed (ADR 0012).
  'repo-pulse-feed': repoPulseFeedSchema,
  // The whole read API envelope of each pushed source.
  'llm-usage': llmUsageEnvelopeSchema,
  shelf: shelfEnvelopeSchema,
  // Push bodies (ADR 0013, ADR 0014).
  'push-llm-usage': llmUsagePushSchema,
  'push-trellis': trellisPushSchema,
};
