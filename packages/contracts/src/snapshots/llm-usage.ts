import { z } from 'zod';
import { envelopeSchema } from '../envelope.ts';
import { dayCountSchema, tokenCountSchema, usdSchema } from '../push/delivery.ts';

const usage = { costUsd: usdSchema.nullable(), totalTokens: tokenCountSchema };

/** `/v1/llm-usage`: what the site shows about the owner's coding-agent usage. */
export const llmUsageSnapshotSchema = z.object({
  last7Days: z.object(usage),
  monthToDate: z.object({
    ...usage,
    cacheSavingsUsd: usdSchema.nullable(),
    /** Public agent names with their share of the month's tokens, largest first. */
    agents: z.array(
      z.object({ agent: z.string().min(1).max(64), ...usage, tokenShare: z.number().min(0).max(1) })
    ),
  }),
  streak: z.object({ currentDays: dayCountSchema, longestDays: dayCountSchema }),
  /** Daily buckets for the year heatmap, oldest first, one per date. */
  days: z.array(z.object({ date: z.iso.date(), ...usage })),
});

export type LlmUsageSnapshot = z.infer<typeof llmUsageSnapshotSchema>;

export const llmUsageEnvelopeSchema = envelopeSchema(
  z.literal('llm-usage'),
  llmUsageSnapshotSchema
);
