import type { z } from 'zod';
import { llmUsageDaysEnvelopeSchema, shippingActivityDaysEnvelopeSchema } from './days.ts';
import { anyEnvelopeSchema } from './envelope.ts';
import { desktopPushSchema } from './push/desktop.ts';
import { llmUsagePushSchema } from './push/llm-usage.ts';
import { trellisPushSchema } from './push/trellis.ts';
import { desktopEnvelopeSchema } from './snapshots/desktop.ts';
import { listeningSnapshotSchema } from './snapshots/listening.ts';
import { listeningHistoryEnvelopeSchema } from './snapshots/listening-history.ts';
import { llmUsageEnvelopeSchema } from './snapshots/llm-usage.ts';
import { monkeytypeEnvelopeSchema } from './snapshots/monkeytype.ts';
import { projectsSnapshotSchema } from './snapshots/projects.ts';
import { shelfEnvelopeSchema } from './snapshots/shelf.ts';
import { repoPulseFeedSchema, shippingSnapshotSchema } from './snapshots/shipping.ts';
import { repoPulseActivitySchema } from './snapshots/shipping-activity.ts';
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
  // What repo-pulse serves on GET /public/activity (ADR 0038).
  'repo-pulse-activity': repoPulseActivitySchema,
  // The whole read API envelope of each pushed source.
  'llm-usage': llmUsageEnvelopeSchema,
  shelf: shelfEnvelopeSchema,
  // A source added after v1 first shipped, so its own envelope is exported and frozen: the
  // generic envelope's frozen consumer only knows the first five sources (ADR 0008).
  weather: weatherEnvelopeSchema,
  'listening-history': listeningHistoryEnvelopeSchema,
  desktop: desktopEnvelopeSchema,
  monkeytype: monkeytypeEnvelopeSchema,
  // Daily history blocks, `GET /v1/days/<series>` (ADR 0038).
  'days-shipping-activity': shippingActivityDaysEnvelopeSchema,
  'days-llm-usage': llmUsageDaysEnvelopeSchema,
  // Push bodies (ADR 0013, ADR 0014, ADR 0032).
  'push-llm-usage': llmUsagePushSchema,
  'push-trellis': trellisPushSchema,
  'push-desktop': desktopPushSchema,
};
