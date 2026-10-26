// Invented collector output for the producers' tests, dry runs and local runs: llm-usage's three
// reports and the desktop's three readings, dated around a given time. No real host or
// session data. `node producers/samples.ts <dir>` writes a set dated now into <dir>.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { datesBetween, reportingDate, reportingTimeZone } from './llm-usage.ts';

const hour = 3_600_000;

const tokens = (date: string) => {
  const day = Number(date.slice(8));
  return day % 4 === 0 ? 0 : 400_000 + day * 37_000;
};

/** Monday on or before `date`, 52 weeks earlier: where llm-usage's activity window starts. */
function windowStart(date: string): string {
  const t = Date.parse(`${date}T00:00:00Z`);
  const monday = t - ((new Date(t).getUTCDay() + 6) % 7) * 864e5;
  return new Date(monday - 52 * 7 * 864e5).toISOString().slice(0, 10);
}

const buckets = (from: string, to: string) =>
  datesBetween(from, to).map((date) => ({
    date,
    value: tokens(date) === 0 ? 0 : Math.round((tokens(date) / 100_000) * 0.9 * hour),
    observed: tokens(date) > 0,
  }));

/** `summary`, `daily` and `trends` as llm-usage 0.14 prints them with `--json`, for `today`. */
export function sampleReports(today: string) {
  const from = windowStart(today);
  const days = datesBetween(from, today).map((date) => ({
    date,
    totalTokens: tokens(date),
    level: tokens(date) === 0 ? 0 : 2,
  }));
  const sum = (since: string) =>
    days.filter((d) => d.date >= since).reduce((s, d) => s + d.totalTokens, 0);
  const totals = (since: string) => ({
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: sum(since),
    costUsd: sum(since) / 400_000,
    events: 10,
    activeDays: 3,
  });
  const weekStart = datesBetween(from, today).at(-7) ?? from;
  const monthStart = `${today.slice(0, 8)}01`;
  const sources = (since: string) => [
    { ...totals(since), source: 'claude', totalTokens: Math.round(sum(since) * 0.7) },
    { ...totals(since), source: 'codex', totalTokens: Math.round(sum(since) * 0.2) },
    { ...totals(since), source: 'pi', totalTokens: Math.round(sum(since) * 0.1) },
  ];
  const period = (key: string, since: string) => ({
    key,
    label: key,
    since,
    until: today,
    totals: totals(since),
    sources: sources(since),
  });
  const summary = {
    schemaVersion: 1,
    report: 'summary',
    data: {
      timezone: reportingTimeZone,
      periods: [
        period('today', today),
        period('last7Days', weekStart),
        period('monthToDate', monthStart),
      ],
      monthToDateCacheSavingsUsd: 12.5,
      activity: {
        from,
        to: today,
        activeDays: days.filter((d) => d.totalTokens > 0).length,
        currentStreak: 3,
        longestStreak: 21,
        days,
      },
    },
  };
  const daily = {
    schemaVersion: 1,
    report: 'usage',
    data: [
      ...days
        .filter((d) => d.totalTokens > 0)
        .flatMap((d) => [
          {
            rowType: 'period_source',
            periodKey: d.date,
            source: 'claude',
            models: ['opus'],
            modelBreakdown: [],
            totalTokens: d.totalTokens,
            costUsd: 1,
          },
          {
            rowType: 'period_combined',
            periodKey: d.date,
            source: 'combined',
            models: ['opus'],
            modelBreakdown: [],
            totalTokens: d.totalTokens,
            costUsd: d.totalTokens / 400_000,
          },
        ]),
      { rowType: 'grand_total', periodKey: 'ALL', source: 'combined', totalTokens: sum(from) },
    ],
  };
  const series = buckets(from, today);
  const trends = {
    schemaVersion: 1,
    report: 'trends',
    data: {
      metric: 'active-hours',
      dateRange: { from, to: today },
      totalSeries: {
        source: 'combined',
        buckets: series,
        summary: {
          total: series.reduce((s, b) => s + b.value, 0),
          average: 0,
          peak: { date: today, value: 0 },
          incomplete: false,
          observedDayCount: series.filter((b) => b.observed).length,
        },
      },
    },
  };
  return { summary, daily, trends };
}

/** The desktop's readings: an Arch kernel, niri with its commit, booted `bootedAt` (ms). */
export function sampleDesktop(bootedAt: number) {
  return {
    'kernel-release': '7.2.11-arch1-1\n',
    'niri-version': 'niri 26.04 (0000000)\n',
    'proc-stat': `cpu  1 2 3 4\nintr 0\nctxt 1\nbtime ${Math.floor(bootedAt / 1000)}\nprocesses 1\n`,
  };
}

/** Writes both sets, dated `now`, into `dir/llm-usage` and `dir/desktop`. */
export function writeSamples(dir: string, now: number): void {
  for (const [name, files] of [
    ['llm-usage', sampleReports(reportingDate(now))],
    ['desktop', sampleDesktop(now - 3 * 24 * hour)],
  ] as const) {
    mkdirSync(join(dir, name), { recursive: true });
    for (const [file, content] of Object.entries(files)) {
      const text = typeof content === 'string' ? content : JSON.stringify(content);
      writeFileSync(join(dir, name, name === 'llm-usage' ? `${file}.json` : file), text);
    }
  }
}

if (import.meta.main) {
  const dir = process.argv[2];
  if (dir === undefined) {
    console.error('usage: samples.ts <dir>');
    process.exitCode = 64;
  } else {
    writeSamples(dir, Date.now());
  }
}
