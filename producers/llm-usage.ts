#!/usr/bin/env node
// The llm-usage producer (ADR 0014): totals from `llm-usage summary`, daily costs from
// `llm-usage daily` and estimated agent time from `llm-usage trends --metric active-hours`,
// pushed to POST /v1/push/llm-usage. Only aggregate numbers leave the machine: no repository,
// path, model, machine, session or prompt field is read into the body.
// Usage: llm-usage.ts | llm-usage.ts --dry-run --fixtures <dir> (see delivery.ts for a local run)
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cli, type Delivery, exitCodes, type Producer, ProducerError } from './delivery.ts';

/** Every report is computed in this zone, so the three reports agree on what a day is. */
export const reportingTimeZone = 'Africa/Casablanca';
/** Most milliseconds of agent time on one local day: Casablanca's longest day is 25 hours. */
export const maxActiveMsPerDay = 25 * 60 * 60 * 1000;
/** Collections tried before giving up when the date keeps changing under them. */
const collections = 3;

/** Runs `llm-usage <args>` and returns its parsed JSON output. */
export type Report = (args: readonly string[]) => Promise<unknown>;

export const machineReport: Report = (args) =>
  new Promise((resolve, reject) => {
    // stderr is ignored: it can name paths and sessions, and nothing of it is logged.
    execFile(
      'llm-usage',
      args,
      { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 10 * 60_000 },
      (error, stdout) => {
        if (error) return reject(new ProducerError('llm_usage_failed', exitCodes.retryLater));
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(new ProducerError('llm_usage_not_json', exitCodes.dataError));
        }
      }
    );
  });

/** `summary.json`, `daily.json` and `trends.json` in `dir`, by the report's first argument. */
export const fixtureReport =
  (dir: string): Report =>
  async (args) =>
    JSON.parse(readFileSync(join(dir, `${args[0]}.json`), 'utf8'));

let dateParts: Intl.DateTimeFormat | undefined;

/** `2026-10-26`: the date in the reporting zone at `time` (Unix ms). */
export function reportingDate(time: number): string {
  dateParts ??= new Intl.DateTimeFormat('en-US', {
    timeZone: reportingTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const {
    year = '',
    month = '',
    day = '',
  } = Object.fromEntries(dateParts.formatToParts(time).map((part) => [part.type, part.value]));
  return `${year.padStart(4, '0')}-${month}-${day}`;
}

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (value: unknown): value is string =>
  typeof value === 'string' &&
  datePattern.test(value) &&
  new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);

/** Every date from `from` to `to`, both included. */
export function datesBetween(from: string, to: string): string[] {
  const dates: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 864e5) {
    dates.push(new Date(t).toISOString().slice(0, 10));
  }
  return dates;
}

const count = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;
const cost = (value: unknown): value is number | undefined =>
  value === undefined || (typeof value === 'number' && Number.isFinite(value) && value >= 0);

/** The report's `data` if `json` is a v1 report named `name`, else undefined. */
function reportData(json: unknown, name: string): unknown {
  const { schemaVersion, report, data } = Object(json);
  return schemaVersion === 1 && report === name ? data : undefined;
}

interface Period {
  since: string;
  until: string;
  totals: { costUsd?: number; totalTokens: number };
  sources: { source: string; costUsd?: number; totalTokens: number }[];
}

export interface Summary {
  last7Days: Period;
  monthToDate: Period;
  cacheSavingsUsd: number | undefined;
  activity: {
    from: string;
    to: string;
    currentStreak: number;
    longestStreak: number;
    days: { date: string; totalTokens: number }[];
  };
}

const invalid = (code: string) => new ProducerError(code, exitCodes.dataError);

/** The summary's fields the push needs, checked; anything else is ignored. */
export function readSummary(json: unknown): Summary {
  const data = Object(reportData(json, 'summary'));
  if (data.timezone !== reportingTimeZone) throw invalid('summary_invalid');
  const { activity, periods, monthToDateCacheSavingsUsd } = data;
  const { from, to, currentStreak, longestStreak, days } = Object(activity);
  if (!isDate(from) || !isDate(to) || from > to || !count(currentStreak) || !count(longestStreak)) {
    throw invalid('summary_invalid');
  }
  const window = datesBetween(from, to);
  if (
    !Array.isArray(days) ||
    days.length !== window.length ||
    days.some((day, i) => Object(day).date !== window[i] || !count(Object(day).totalTokens))
  ) {
    throw invalid('summary_invalid');
  }
  const period = (key: string): Period => {
    const found = Array.isArray(periods) ? periods.find((p) => Object(p).key === key) : undefined;
    const { since, until, totals, sources } = Object(found);
    const valid =
      isDate(since) &&
      isDate(until) &&
      from <= since &&
      since <= until &&
      until === to &&
      count(Object(totals).totalTokens) &&
      cost(Object(totals).costUsd) &&
      Array.isArray(sources) &&
      sources.every(
        (s) =>
          typeof Object(s).source === 'string' &&
          count(Object(s).totalTokens) &&
          cost(Object(s).costUsd)
      );
    if (!valid) throw invalid('summary_invalid');
    return { since, until, totals, sources };
  };
  if (!cost(monthToDateCacheSavingsUsd)) throw invalid('summary_invalid');
  return {
    last7Days: period('last7Days'),
    monthToDate: period('monthToDate'),
    cacheSavingsUsd: monthToDateCacheSavingsUsd,
    activity: { from, to, currentStreak, longestStreak, days },
  };
}

/** The combined cost of each day from `llm-usage daily`; a day without a row has no usage. */
export function readDailyCosts(
  json: unknown,
  from: string,
  to: string
): Map<string, number | null> {
  const rows = reportData(json, 'usage');
  if (!Array.isArray(rows)) throw invalid('daily_invalid');
  const costs = new Map<string, number | null>();
  for (const row of rows) {
    const { rowType, periodKey, costUsd } = Object(row);
    if (rowType !== 'period_combined') continue;
    if (!isDate(periodKey) || periodKey < from || periodKey > to || costs.has(periodKey)) {
      throw invalid('daily_invalid');
    }
    if (!cost(costUsd)) throw invalid('daily_invalid');
    costs.set(periodKey, costUsd ?? null);
  }
  return costs;
}

/**
 * Agent time per day from `llm-usage trends --metric active-hours`, or undefined when the
 * report cannot be trusted: then the push carries no agent time at all, never a guessed 0.
 * The combined series must hold one whole number of milliseconds within a day's bound for
 * each date from `from` to `to`, and nothing else.
 */
export function readActiveMs(
  json: unknown,
  from: string,
  to: string
): Map<string, number> | undefined {
  const { metric, dateRange, totalSeries } = Object(reportData(json, 'trends'));
  const { source, buckets } = Object(totalSeries);
  if (
    metric !== 'active-hours' ||
    source !== 'combined' ||
    Object(dateRange).from !== from ||
    Object(dateRange).to !== to ||
    !Array.isArray(buckets)
  ) {
    return undefined;
  }
  const byDate = new Map<string, number>();
  for (const bucket of buckets) {
    const { date, value } = Object(bucket);
    if (!isDate(date) || byDate.has(date) || !count(value) || value > maxActiveMsPerDay) {
      return undefined;
    }
    byDate.set(date, value);
  }
  const window = datesBetween(from, to);
  if (byDate.size !== window.length || window.some((date) => !byDate.has(date))) return undefined;
  return byDate;
}

/** The sum of `days` from `since` to `until`, both included. */
const total = (days: Map<string, number>, { since, until }: Period) =>
  datesBetween(since, until).reduce((sum, date) => sum + (days.get(date) ?? 0), 0);

const usage = (totals: { costUsd?: number; totalTokens: number }) => ({
  costUsd: totals.costUsd ?? null,
  totalTokens: totals.totalTokens,
});

/**
 * The push payload from the three reports, joined by date. Agent time is all there or all
 * absent: a report that fails its checks drops every `activeMs`, and the tokens and costs
 * still go.
 */
export function payload(
  summary: Summary,
  costs: Map<string, number | null>,
  activeMs?: Map<string, number>
) {
  const hours = (value: number) => (activeMs === undefined ? {} : { activeMs: value });
  const month = summary.monthToDate;
  return {
    last7Days: {
      ...usage(summary.last7Days.totals),
      ...hours(activeMs ? total(activeMs, summary.last7Days) : 0),
    },
    monthToDate: {
      ...usage(month.totals),
      ...hours(activeMs ? total(activeMs, month) : 0),
      cacheSavingsUsd: summary.cacheSavingsUsd ?? null,
      agents: month.sources.slice(0, 32).map((s) => ({ agent: s.source, ...usage(s) })),
    },
    streak: {
      currentDays: summary.activity.currentStreak,
      longestDays: summary.activity.longestStreak,
    },
    days: summary.activity.days.map((day) => ({
      date: day.date,
      totalTokens: day.totalTokens,
      // A day without tokens cost nothing; a day with tokens and no price is unknown.
      costUsd: day.totalTokens === 0 ? 0 : (costs.get(day.date) ?? null),
      ...hours(activeMs?.get(day.date) ?? 0),
    })),
  };
}

export function llmUsageProducer(
  report: Report,
  now: () => number = Date.now,
  log: (fields: Record<string, string>) => void = (f) => console.log(JSON.stringify(f))
): Producer {
  const zone = ['--timezone', reportingTimeZone];
  return {
    id: 'llm-usage',
    async build(): Promise<Delivery> {
      for (let attempt = 1; attempt <= collections; attempt++) {
        const startedAt = now();
        const date = reportingDate(startedAt);
        // Summary first: its window fixes the dates the other two reports are asked for.
        const summary = readSummary(await report(['summary', ...zone, '--json']));
        const { from, to } = summary.activity;
        if (to === date) {
          const range = ['--since', from, '--until', to, ...zone, '--json'];
          const costs = readDailyCosts(await report(['daily', ...range]), from, to);
          let activeMs: Map<string, number> | undefined;
          try {
            activeMs = readActiveMs(
              await report(['trends', '--metric', 'active-hours', ...range]),
              from,
              to
            );
          } catch {}
          if (activeMs === undefined) {
            log({ producer: 'llm-usage', event: 'agent_hours_unavailable' });
          }
          // A collection that crossed midnight mixes two days' periods: it is collected again.
          if (reportingDate(now()) === date) {
            return {
              producer: 'llm-usage',
              deliveryId: crypto.randomUUID(),
              sentAt: new Date(startedAt).toISOString(),
              payload: payload(summary, costs, activeMs),
            };
          }
        }
        log({ producer: 'llm-usage', event: 'date_changed' });
      }
      throw new ProducerError('date_kept_changing', exitCodes.retryLater);
    },
  };
}

if (import.meta.main) {
  process.exitCode = await cli('llm-usage', 'PUSH_TOKEN_LLM_USAGE', (fixtures) =>
    llmUsageProducer(fixtures === null ? machineReport : fixtureReport(fixtures))
  );
}
