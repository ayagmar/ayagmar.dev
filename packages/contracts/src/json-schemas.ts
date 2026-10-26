import type { z } from 'zod';
import { anyEnvelopeSchema } from './envelope.ts';
import { llmUsagePushSchema } from './push/llm-usage.ts';
import { trellisPushSchema } from './push/trellis.ts';
import { listeningSnapshotSchema } from './snapshots/listening.ts';
import { listeningHistoryEnvelopeSchema } from './snapshots/listening-history.ts';
import { llmUsageEnvelopeSchema } from './snapshots/llm-usage.ts';
import { projectsSnapshotSchema } from './snapshots/projects.ts';
import { shelfEnvelopeSchema } from './snapshots/shelf.ts';
import { repoPulseFeedSchema, shippingSnapshotSchema } from './snapshots/shipping.ts';
import { weatherEnvelopeSchema } from './snapshots/weather.ts';

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
  // A source added after v1 first shipped, so its own envelope is exported and frozen: the
  // generic envelope's frozen consumer only knows the first five sources (ADR 0008).
  weather: weatherEnvelopeSchema,
  'listening-history': listeningHistoryEnvelopeSchema,
  // Push bodies (ADR 0013, ADR 0014).
  'push-llm-usage': llmUsagePushSchema,
  'push-trellis': trellisPushSchema,
};
