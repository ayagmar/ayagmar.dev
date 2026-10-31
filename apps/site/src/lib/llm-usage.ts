/**
 * Reading `/v1/llm-usage` (ADR 0014) in the browser: the whole snapshot for the LLM usage panel
 * on /stats (drawn by src/lib/llm-usage-panel.ts), and this month's agents for /uses. The
 * browser does not load zod, so the contract's checks are repeated here, and the tests hold
 * them to the contract's corpus.
 */
import type { LlmUsageSnapshot } from '@min7/contracts';
import { rabatDate } from '@min7/contracts/rabat';
import { calendarDate, instantMs, list, text, whole } from './live.ts';
import { knowsRabatDate } from './rabat-date.ts';

const hourMs = 3_600_000;
// The contract's bounds (packages/contracts/src/push/delivery.ts): 25-hour local days.
const maxDayMs = 25 * hourMs;
const maxWeekMs = 7 * maxDayMs;
const maxMonthMs = 31 * maxDayMs;

const tokenCount = (value: unknown) => whole(value) && (value as number) <= 1e18;
const usd = (value: unknown) =>
  value === null || (typeof value === 'number' && value >= 0 && value <= 1_000_000);
const activeMs = (value: unknown, max: number) =>
  value === undefined || (whole(value) && (value as number) <= max);
const dayCount = (value: unknown) => whole(value) && (value as number) <= 36_600;
const usage = (value: unknown, maxMs: number) => {
  const { costUsd, totalTokens, activeMs: ms } = Object(value);
  return usd(costUsd) && tokenCount(totalTokens) && activeMs(ms, maxMs);
};

/** `data` if it is an llm-usage snapshot as the contract states it, else undefined. */
export function readLlmUsageSnapshot(data: unknown): LlmUsageSnapshot | undefined {
  const { last7Days, monthToDate, streak, days } = Object(data);
  const month = Object(monthToDate);
  const { currentDays, longestDays } = Object(streak);
  return usage(last7Days, maxWeekMs) &&
    usage(monthToDate, maxMonthMs) &&
    usd(month.cacheSavingsUsd) &&
    list(month.agents, Infinity, (item) => {
      const { agent, costUsd, totalTokens, tokenShare } = Object(item);
      return (
        text(agent, 64) &&
        usd(costUsd) &&
        tokenCount(totalTokens) &&
        typeof tokenShare === 'number' &&
        tokenShare >= 0 &&
        tokenShare <= 1
      );
    }) &&
    dayCount(currentDays) &&
    dayCount(longestDays) &&
    list(days, Infinity, (item) => calendarDate(Object(item).date) && usage(item, maxDayMs))
    ? (data as LlmUsageSnapshot)
    : undefined;
}

/**
 * This month's agents for /uses, most tokens first, or undefined for nothing: shown only from
 * a current snapshot taken on today's date in Rabat, since after midnight "this month" may be
 * another month. A snapshot that is stale, dated after the browser's clock or on a day the
 * calendar does not have, or read by a browser that does not know Morocco's clock, shows
 * nothing.
 */
export function readLlmUsage(
  body: unknown,
  now: number
): { fetchedAt: string; agents: string[] } | undefined {
  const { source, version, stale, fetchedAt, data } = Object(body);
  if (source !== 'llm-usage' || version !== 1 || stale !== false) return;
  const taken = instantMs(fetchedAt, true);
  if (taken === undefined || taken > now || !knowsRabatDate()) return;
  if (rabatDate(taken) !== rabatDate(now)) return;
  const snapshot = readLlmUsageSnapshot(data);
  if (!snapshot) return;
  return { fetchedAt, agents: snapshot.monthToDate.agents.map(({ agent }) => agent) };
}
