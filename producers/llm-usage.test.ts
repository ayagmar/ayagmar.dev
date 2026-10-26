// The llm-usage producer (ADR 0014): the commands it runs, how the three reports are joined
// by date, when agent time is left out, and what happens when the date changes mid-collection.
// The reports are invented (samples.ts); llm-usage itself never runs.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { llmUsagePushSchema } from '../packages/contracts/src/index.ts';
import { rabatDate } from '../packages/contracts/src/rabat.ts';
import {
  datesBetween,
  llmUsageProducer,
  maxActiveMsPerDay,
  type Report,
  reportingDate,
} from './llm-usage.ts';
import { sampleReports } from './samples.ts';

type Reports = ReturnType<typeof sampleReports>;
type Payload = {
  last7Days: { activeMs?: number; totalTokens: number };
  monthToDate: { activeMs?: number; totalTokens: number };
  days: { date: string; activeMs?: number; totalTokens: number; costUsd: number | null }[];
};

/** A stand-in `llm-usage` answering from `reports(call number)`, recording every argv. */
function fake(reports: (call: number) => Reports, edit: (r: Reports) => void = () => {}) {
  const calls: string[][] = [];
  const report: Report = async (args) => {
    calls.push([...args]);
    const r = structuredClone(reports(calls.length));
    edit(r);
    return r[args[0] as keyof Reports];
  };
  return { report, calls };
}

const noon = Date.parse('2026-10-26T12:00:00Z');
const at = (time: number) => () => time;
const build = async (report: Report, now: () => number = at(noon)) => {
  const logs: string[] = [];
  const delivery = await llmUsageProducer(report, now, (f) => logs.push(f.event ?? '')).build();
  return { delivery, payload: delivery.payload as Payload, logs };
};
const hoursIn = (payload: Payload) => JSON.stringify(payload).includes('activeMs');

// Catches a call on the system timezone, a missing or different range, or another filter.
it('asks for summary first, then daily and trends over its window, all in Africa/Casablanca', async () => {
  const { report, calls } = fake(() => sampleReports('2026-10-26'));
  await build(report);

  const { from } = sampleReports('2026-10-26').summary.data.activity;
  const range = [
    '--since',
    from,
    '--until',
    '2026-10-26',
    '--timezone',
    'Africa/Casablanca',
    '--json',
  ];
  assert.deepEqual(calls, [
    ['summary', '--timezone', 'Africa/Casablanca', '--json'],
    ['daily', ...range],
    ['trends', '--metric', 'active-hours', ...range],
  ]);
});

// The reporting date must not follow the machine's zone; it is the one site and Worker use.
it('dates the collection in Rabat whatever the system zone', () => {
  for (const time of [
    Date.parse('2026-02-14T23:30:00Z'),
    Date.parse('2026-02-15T23:30:00Z'),
    Date.parse('2026-03-22T23:59:59Z'),
    Date.parse('2026-10-26T23:59:59Z'),
    Date.parse('2026-12-31T23:30:00Z'),
  ]) {
    assert.equal(reportingDate(time), rabatDate(time));
  }
});

describe('agent hours', () => {
  // Catches sums over the whole year's series, by position instead of date, or over the
  // wrong period, including a week across a month and a year boundary.
  for (const today of ['2026-10-26', '2027-01-03']) {
    it(`sums exactly each period's dates (${today})`, async () => {
      const reports = sampleReports(today);
      const { payload, delivery } = await build(
        fake(() => reports).report,
        at(Date.parse(`${today}T12:00:00Z`))
      );
      const value = new Map(reports.trends.data.totalSeries.buckets.map((b) => [b.date, b.value]));
      const sum = (since: string) =>
        datesBetween(since, today).reduce((s, d) => s + (value.get(d) ?? 0), 0);
      const [, week, month] = reports.summary.data.periods;

      assert.equal(payload.last7Days.activeMs, sum(week?.since ?? ''));
      assert.equal(payload.monthToDate.activeMs, sum(month?.since ?? ''));
      assert.ok((payload.last7Days.activeMs ?? 0) < reports.trends.data.totalSeries.summary.total);
      for (const day of payload.days) assert.equal(day.activeMs, value.get(day.date));
      assert.equal(llmUsagePushSchema.safeParse(delivery).error, undefined);
    });
  }

  // Catches a real zero turned into "unknown", and a 25-hour day rejected or clamped.
  it('keeps a zero day and a 25-hour day as measured', async () => {
    const { payload, delivery } = await build(
      fake(
        () => sampleReports('2026-10-26'),
        (r) => {
          const buckets = r.trends.data.totalSeries.buckets;
          (buckets.at(-1) as { value: number }).value = 0;
          (buckets.at(-2) as { value: number }).value = maxActiveMsPerDay;
        }
      ).report
    );
    assert.equal(payload.days.at(-1)?.activeMs, 0);
    assert.equal(payload.days.at(-2)?.activeMs, 90_000_000);
    assert.equal(llmUsagePushSchema.safeParse(delivery).error, undefined);
  });

  // Each case is a trends answer that cannot be trusted. Catches a guessed 0, a partial
  // series published as complete, and a broken trends call blocking tokens and costs.
  const broken: [string, (r: Reports) => void][] = [
    ['another schema version', (r) => Object.assign(r.trends, { schemaVersion: 2 })],
    ['another report', (r) => Object.assign(r.trends, { report: 'summary' })],
    ['another metric', (r) => Object.assign(r.trends.data, { metric: 'tokens' })],
    ['a per-source series', (r) => Object.assign(r.trends.data.totalSeries, { source: 'claude' })],
    ['another range', (r) => Object.assign(r.trends.data.dateRange, { from: '2026-10-01' })],
    ['a missing day', (r) => r.trends.data.totalSeries.buckets.splice(10, 1)],
    [
      'a repeated day',
      (r) =>
        r.trends.data.totalSeries.buckets.splice(
          10,
          1,
          r.trends.data.totalSeries.buckets[11] as never
        ),
    ],
    [
      'an extra day',
      (r) =>
        r.trends.data.totalSeries.buckets.push({ date: '2026-10-27', value: 1, observed: true }),
    ],
    [
      'a fractional value',
      (r) => Object.assign(r.trends.data.totalSeries.buckets[3] ?? {}, { value: 1.5 }),
    ],
    [
      'a negative value',
      (r) => Object.assign(r.trends.data.totalSeries.buckets[3] ?? {}, { value: -1 }),
    ],
    [
      'a day over 25 hours',
      (r) =>
        Object.assign(r.trends.data.totalSeries.buckets[3] ?? {}, { value: maxActiveMsPerDay + 1 }),
    ],
    ['no answer', (r) => Object.assign(r, { trends: undefined })],
  ];
  for (const [name, edit] of broken) {
    it(`leaves every agent-hours field out for ${name}, and sends the rest`, async () => {
      const { payload, delivery, logs } = await build(
        fake(() => sampleReports('2026-10-26'), edit).report
      );
      assert.equal(hoursIn(payload), false);
      assert.ok(payload.monthToDate.totalTokens > 0);
      assert.ok(logs.includes('agent_hours_unavailable'));
      assert.equal(llmUsagePushSchema.safeParse(delivery).error, undefined);
    });
  }

  it('sends the rest when the trends command fails', async () => {
    const report: Report = async (args) => {
      if (args[0] === 'trends') throw new Error('exit 1');
      return sampleReports('2026-10-26')[args[0] as keyof Reports];
    };
    assert.equal(hoursIn((await build(report)).payload), false);
  });

  // The three reports are not one snapshot: the laptop can sync between them. The mapping
  // joins by date and publishes each report's own numbers rather than failing.
  it('publishes hours on a day the summary saw no tokens for', async () => {
    const { payload } = await build(
      fake(
        () => sampleReports('2026-10-26'),
        (r) => {
          const zero = r.summary.data.activity.days.find((d) => d.totalTokens === 0);
          const bucket = r.trends.data.totalSeries.buckets.find((b) => b.date === zero?.date);
          if (bucket) bucket.value = 60_000;
        }
      ).report
    );
    const day = payload.days.find((d) => d.totalTokens === 0 && d.activeMs === 60_000);
    assert.equal(day?.costUsd, 0);
  });
});

describe('summary and daily', () => {
  // Catches a delivery built from a report it cannot read.
  const broken: [string, (r: Reports) => void][] = [
    ['a summary in another zone', (r) => Object.assign(r.summary.data, { timezone: 'UTC' })],
    ['a summary without activity', (r) => Object.assign(r.summary.data, { activity: undefined })],
    ['a summary with a gap in its days', (r) => r.summary.data.activity.days.splice(4, 1)],
    ['a summary without its month', (r) => r.summary.data.periods.pop()],
    ['a daily report of another kind', (r) => Object.assign(r.daily, { report: 'summary' })],
    ['a daily row twice', (r) => r.daily.data.push(r.daily.data.at(-2) as never)],
  ];
  for (const [name, edit] of broken) {
    it(`creates no delivery from ${name}`, async () => {
      await assert.rejects(build(fake(() => sampleReports('2026-10-26'), edit).report), /_invalid/);
    });
  }
});

describe('midnight', () => {
  // Catches yesterday's month and today's hours (or the other way round) in one delivery.
  for (const [name, before, after] of [
    ['a day', '2026-10-26', '2026-10-27'],
    ['a month', '2026-10-31', '2026-11-01'],
  ] as const) {
    it(`collects again when ${name} ends between the calls`, async () => {
      let time = Date.parse(`${before}T23:59:58Z`);
      // The clock passes midnight while daily runs, the first time only.
      const { report, calls } = fake((call) => {
        if (call === 2) time = Date.parse(`${after}T00:00:01Z`);
        return sampleReports(call <= 3 ? before : after);
      });
      const { delivery, payload, logs } = await build(report, () => time);

      assert.ok(logs.includes('date_changed'));
      assert.equal(calls.length, 6);
      assert.equal(calls[3]?.[0], 'summary');
      assert.equal(payload.days.at(-1)?.date, after);
      assert.equal(delivery.sentAt, `${after}T00:00:01.000Z`);
    });
  }

  it('collects again when summary already describes the next day', async () => {
    const { report, calls } = fake((call) =>
      sampleReports(call === 1 ? '2026-10-27' : '2026-10-26')
    );
    await build(report);
    assert.deepEqual(
      calls.map((c) => c[0]),
      ['summary', 'summary', 'daily', 'trends']
    );
  });
});
