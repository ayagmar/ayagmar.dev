/**
 * The parts of `/v1/llm-usage` the browser shows (ADR 0014): estimated agent hours on /stats
 * and this month's agents on /uses. Pure functions; the page scripts and the tests share them.
 * The browser does not load zod, so the contract's checks that matter here are repeated, and
 * the tests hold them to the contract's corpus.
 */
import { rabatDate } from '@min7/contracts/rabat';
import { instantMs } from './live.ts';
import { knowsRabatDate } from './rabat-date.ts';

const hourMs = 3_600_000;
// The contract's bounds (packages/contracts/src/push/delivery.ts): 25-hour local days.
const maxDayMs = 25 * hourMs;
const maxWeekMs = 7 * maxDayMs;
const maxMonthMs = 31 * maxDayMs;

export interface LlmUsage {
  /** When the producer took the snapshot. */
  fetchedAt: string;
  /** Agent time this month and in the last 7 days, each absent when not sent. */
  monthMs?: number;
  weekMs?: number;
  /** Public agent names, most tokens first; absent when the list cannot be read. */
  agents?: string[];
}

const within = (value: unknown, max: number): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= max;

/**
 * What a `/v1/llm-usage` answer lets the page show at `now`, or undefined for nothing. Its
 * month and week are the producer's, so they are shown only on the date in Rabat they were
 * taken: after midnight "this month" and "last 7 days" would describe another period. A
 * snapshot that is stale, dated after the browser's clock or on a day the calendar does not
 * have, or read by a browser that does not know Morocco's clock, shows nothing.
 */
export function readLlmUsage(body: unknown, now: number): LlmUsage | undefined {
  const { source, version, stale, fetchedAt, data } = Object(body);
  if (source !== 'llm-usage' || version !== 1 || stale !== false || data === null) return;
  const taken = instantMs(fetchedAt, true);
  if (taken === undefined || taken > now || !knowsRabatDate()) return;
  if (rabatDate(taken) !== rabatDate(now)) return;
  const { monthToDate, last7Days, days } = Object(data);
  const month = Object(monthToDate);
  const week = Object(last7Days);
  const usage: LlmUsage = { fetchedAt };
  // Hours are shown only if every value sent is one the contract allows: one out of range
  // anywhere means the snapshot's hours cannot be trusted.
  const sent = (value: unknown, max: number) => value === undefined || within(value, max);
  const trusted =
    sent(month.activeMs, maxMonthMs) &&
    sent(week.activeMs, maxWeekMs) &&
    Array.isArray(days) &&
    days.every((entry) => sent(Object(entry).activeMs, maxDayMs));
  if (trusted && month.activeMs !== undefined) usage.monthMs = month.activeMs;
  if (trusted && week.activeMs !== undefined) usage.weekMs = week.activeMs;
  const { agents } = month;
  if (
    Array.isArray(agents) &&
    agents.length <= 64 &&
    agents.every((entry) => {
      const { agent } = Object(entry);
      return typeof agent === 'string' && agent.length >= 1 && agent.length <= 64;
    })
  ) {
    usage.agents = agents.map((entry) => Object(entry).agent);
  }
  return usage;
}

/** `283 hours`, `7.5 hours`, `0 hours`: whole hours from 10 up, one decimal below. */
export function hours(ms: number): string {
  const value = ms / hourMs;
  const shown = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${shown.toLocaleString('en')} ${shown === 1 ? 'hour' : 'hours'}`;
}
