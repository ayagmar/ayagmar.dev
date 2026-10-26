import type { z } from 'zod';
import { anyEnvelopeSchema } from './envelope.ts';

/** Schemas exported as JSON Schema to `schema/<name>.{input,output}.json` for other languages. */
export const jsonSchemas: Readonly<Record<string, z.ZodType>> = {
  envelope: anyEnvelopeSchema,
};
