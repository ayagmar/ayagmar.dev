import {
  type LlmUsagePush,
  type LlmUsageSnapshot,
  llmUsagePushSchema,
  llmUsageSnapshotSchema,
} from '@min7/contracts';
import { byCodeUnit, type Producer } from './producers.ts';
import { agentLabels } from './public-labels.ts';

/** `{ activeMs }` when the producer sent it, else nothing, so the key stays absent. */
const hours = (activeMs: number | undefined) => (activeMs === undefined ? {} : { activeMs });

/**
 * Builds the published snapshot field by field from the validated push, so nothing reaches
 * storage that is not named here. Agents without a reviewed label are dropped; a repeated
 * label keeps its first entry. Shares are of the month's total tokens, unknown agents
 * included, so dropping one never inflates the others. Estimated agent time (`activeMs`) is
 * kept where the producer sent it and left out where it did not: unknown, never 0.
 */
function projectLlmUsage({ payload }: LlmUsagePush): LlmUsageSnapshot {
  const month = payload.monthToDate;
  const agents = new Map<string, LlmUsageSnapshot['monthToDate']['agents'][number]>();
  for (const { agent, costUsd, totalTokens } of month.agents) {
    const label = agentLabels.get(agent);
    if (label === undefined || agents.has(label)) continue;
    const share = month.totalTokens > 0 ? Math.min(1, totalTokens / month.totalTokens) : 0;
    agents.set(label, {
      agent: label,
      costUsd,
      totalTokens,
      tokenShare: Math.round(share * 10_000) / 10_000,
    });
  }

  const days = new Map<string, LlmUsageSnapshot['days'][number]>();
  for (const { date, costUsd, totalTokens, activeMs } of payload.days) {
    if (!days.has(date)) days.set(date, { date, costUsd, totalTokens, ...hours(activeMs) });
  }

  return {
    last7Days: {
      costUsd: payload.last7Days.costUsd,
      totalTokens: payload.last7Days.totalTokens,
      ...hours(payload.last7Days.activeMs),
    },
    monthToDate: {
      costUsd: month.costUsd,
      totalTokens: month.totalTokens,
      ...hours(month.activeMs),
      cacheSavingsUsd: month.cacheSavingsUsd,
      agents: [...agents.values()].sort(
        (a, b) => b.totalTokens - a.totalTokens || byCodeUnit(a.agent, b.agent)
      ),
    },
    streak: { currentDays: payload.streak.currentDays, longestDays: payload.streak.longestDays },
    days: [...days.values()].sort((a, b) => byCodeUnit(a.date, b.date)),
  };
}

export const llmUsageProducer: Producer<LlmUsagePush> = {
  id: 'llm-usage',
  source: 'llm-usage',
  schema: llmUsagePushSchema,
  snapshotSchema: llmUsageSnapshotSchema,
  project: projectLlmUsage,
  tokens: (env) => [env.PUSH_TOKEN_LLM_USAGE, env.PUSH_TOKEN_LLM_USAGE_NEXT],
  signingKeys: null,
};
