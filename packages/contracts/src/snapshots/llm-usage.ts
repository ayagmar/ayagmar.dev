import { z } from 'zod';
import { envelopeSchema } from '../envelope.ts';
import {
  dayActiveMsSchema,
  dayCountSchema,
  monthActiveMsSchema,
  tokenCountSchema,
  usdSchema,
  weekActiveMsSchema,
} from '../push/delivery.ts';

const usage = { costUsd: usdSchema.nullable(), totalTokens: tokenCountSchema };

/** One local calendar day in Africa/Casablanca (ADR 0014). */
export const llmUsageDaySchema = z.object({
  date: z.iso.date(),
  ...usage,
  activeMs: dayActiveMsSchema.optional(),
});

export type LlmUsageDay = z.infer<typeof llmUsageDaySchema>;

/**
 * `/v1/llm-usage`: what the site shows about the owner's coding-agent usage. `activeMs` is the
 * estimated agent time (ADR 0014), absent when the producer did not send it: unknown, not 0.
 */
export const llmUsageSnapshotSchema = z.object({
  last7Days: z.object({ ...usage, activeMs: weekActiveMsSchema.optional() }),
  monthToDate: z.object({
    ...usage,
    activeMs: monthActiveMsSchema.optional(),
    cacheSavingsUsd: usdSchema.nullable(),
    /** Public agent names with their share of the month's tokens, largest first. */
    agents: z.array(
      z.object({ agent: z.string().min(1).max(64), ...usage, tokenShare: z.number().min(0).max(1) })
    ),
  }),
  streak: z.object({ currentDays: dayCountSchema, longestDays: dayCountSchema }),
  /** Daily buckets for the year heatmap, oldest first, one per date. */
  days: z.array(llmUsageDaySchema),
});

export type LlmUsageSnapshot = z.infer<typeof llmUsageSnapshotSchema>;

export const llmUsageEnvelopeSchema = envelopeSchema(
  z.literal('llm-usage'),
  llmUsageSnapshotSchema
);
