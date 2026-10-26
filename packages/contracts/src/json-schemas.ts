import type { z } from 'zod';
import { anyEnvelopeSchema } from './envelope.ts';
import { llmUsagePushSchema } from './push/llm-usage.ts';
import { trellisPushSchema } from './push/trellis.ts';
import { llmUsageEnvelopeSchema } from './snapshots/llm-usage.ts';
import { shelfEnvelopeSchema } from './snapshots/shelf.ts';

/** Schemas exported as JSON Schema to `schema/<name>.{input,output}.json` for other languages. */
export const jsonSchemas: Readonly<Record<string, z.ZodType>> = {
  envelope: anyEnvelopeSchema,
  'llm-usage': llmUsageEnvelopeSchema,
  shelf: shelfEnvelopeSchema,
  'push-llm-usage': llmUsagePushSchema,
  'push-trellis': trellisPushSchema,
};
