import { z } from 'zod';
import {
  dayActiveMsSchema,
  dayCountSchema,
  monthActiveMsSchema,
  pushDeliverySchema,
  tokenCountSchema,
  usdSchema,
  weekActiveMsSchema,
} from './delivery.ts';

// `costUsd` is null when llm-usage-metrics could not price the usage, never a guessed 0.
const usage = { costUsd: usdSchema.nullable(), totalTokens: tokenCountSchema };
// Estimated agent time (ADR 0014), from `llm-usage trends --metric active-hours`. Optional and
// without a default: absent means unknown, never 0 h, and a producer from before it stays valid.

/**
 * What the llm-usage-metrics timer pushes: aggregate numbers only (ADR 0014). `agent` is the
 * llm-usage source id (`claude`, `codex`, ...); signals publishes only ids it has a reviewed
 * label for and drops the rest.
 */
export const llmUsagePushPayloadSchema = z.object({
  last7Days: z.object({ ...usage, activeMs: weekActiveMsSchema.optional() }),
  monthToDate: z.object({
    ...usage,
    activeMs: monthActiveMsSchema.optional(),
    cacheSavingsUsd: usdSchema.nullable(),
    agents: z.array(z.object({ agent: z.string().min(1).max(128), ...usage })).max(32),
  }),
  streak: z.object({ currentDays: dayCountSchema, longestDays: dayCountSchema }),
  /** One entry per active or inactive day, up to 53 weeks back. */
  days: z
    .array(z.object({ date: z.iso.date(), ...usage, activeMs: dayActiveMsSchema.optional() }))
    .max(371),
});

export const llmUsagePushSchema = pushDeliverySchema('llm-usage', llmUsagePushPayloadSchema);

export type LlmUsagePush = z.infer<typeof llmUsagePushSchema>;
