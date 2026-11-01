import { createScheduledController } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { SourceId } from '@min7/contracts';
import { rabatDate } from '@min7/contracts/rabat';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pullAdapters } from '../src/adapters/pull/index.ts';
import type { PullAdapter } from '../src/adapters/types.ts';
import { runScheduled } from '../src/cron/run.ts';
import worker from '../src/index.ts';
import { D1SnapshotStore } from '../src/storage/d1.ts';
import { clearState, deliveryRows, fetchApi } from './helpers.ts';

beforeEach(clearState);

const minute = 60_000;

/** A fake adapter: its upstream is the boundary, so `fetch` is the stand-in. */
const adapter = (
  id: SourceId,
  intervalSeconds: number,
  fetch: PullAdapter['fetch'] = async () => ({ id })
): PullAdapter & { calls: number } => {
  const fake = {
    id,
    intervalSeconds,
    calls: 0,
    async fetch(e: Env, signal: AbortSignal) {
      fake.calls++;
      return fetch(e, signal);
    },
    normalize: (raw: unknown) => ({ normalized: raw }),
  };
  return fake;
};

/** How long each stand-in's fetch takes, close to production's. */
const durationMs: Partial<Record<SourceId, number>> = {
  listening: 1500,
  shipping: 900,
  projects: 8000,
  weather: 700,
  'listening-history': 800,
  // Two requests, one after the other.
  monkeytype: 1000,
  'shipping-activity': 900,
};

/**
 * The real registry's sources, intervals and due rules, each fetch replaced by `fetch` after
 * the source's usual duration.
 */
const standIns = (fetch: (id: SourceId) => Promise<unknown>) =>
  pullAdapters.map(({ id, intervalSeconds, dueAt }) =>
    Object.assign(
      adapter(id, intervalSeconds, async () => {
        vi.setSystemTime(Date.now() + (durationMs[id] ?? 1000));
        return fetch(id);
      }),
      // The history's snapshot is stored as it comes, so its `describedDate` is seen.
      id === 'listening-history' ? { dueAt, normalize: (raw: unknown) => raw } : { dueAt }
    )
  );

/**
 * A stand-in for the history's upstream (ADR 0030): a pull of three years takes three
 * invocations, its progress kept for the Rabat date the pull began on, as the real one keeps
 * it in D1, and publishes that date. `published` holds the time of each finished pull.
 */
function historyStandIn() {
  const progress = { date: '', read: 0 };
  const published: number[] = [];
  return {
    published,
    async part(fails = false) {
      const date = rabatDate(Date.now());
      if (progress.date !== date) Object.assign(progress, { date, read: 0 });
      if (fails) throw Object.assign(new Error('429'), { code: 'upstream_rate_limited' });
      if (++progress.read < 3) throw Object.assign(new Error('part'), { code: 'in_progress' });
      progress.date = '';
      published.push(Date.now());
      return { describedDate: date };
    },
  };
}

describe('scheduled', () => {
  it('runs with the empty adapter registry and still cleans up', async () => {
    await env.DB.prepare(
      "INSERT INTO push_deliveries (producer, delivery_id, body_sha256, received_at) VALUES ('trellis', 'old', 'h', 0)"
    ).run();
    const controller = createScheduledController({ scheduledTime: Date.now() });

    await worker.scheduled(controller, env);

    expect(await deliveryRows()).toEqual([]);
  });

  it('stores what each adapter normalizes, and serves it', async () => {
    const listening = adapter('listening', 60);
    await runScheduled(env, [listening], Date.now());

    const body = await fetchApi('/v1/listening').then((r) => r.json());
    expect(body).toMatchObject({ stale: false, data: { normalized: { id: 'listening' } } });
  });

  it('pulls one adapter per run, the most overdue first, so a frequent one starves none', async () => {
    const pulled: string[] = [];
    const track = (id: SourceId, intervalSeconds: number) =>
      adapter(id, intervalSeconds, async () => {
        pulled.push(id);
        return {};
      });
    const adapters = [track('listening', 60), track('projects', 24 * 3600), track('shipping', 900)];
    const start = Date.now();

    for (let run = 0; run < 5; run++) await runScheduled(env, adapters, start + run * minute);

    expect(pulled).toEqual(['listening', 'projects', 'shipping', 'listening', 'listening']);
  });

  // Two days of minute triggers with the real registry's sources, intervals and due rules
  // (ADR 0029, ADR 0030, ADR 0033), across Rabat's midnight at +01 and at +00 and the change
  // between them on 20 September 2026. Both clocks move: the trigger's scheduledTime, and Date,
  // which stamps each stored attempt. Fetches take time; weather fails for six hours, every
  // third failure hanging until the runner's 20 s timeout; the history fails from 23:50 to
  // 00:01 around the second midnight; Monkeytype has no key for the first day, then is
  // refused once. Catches a source starved by the others, a failing one hogging
  // the slot, two adapters sharing an invocation, and a history that waits for its interval
  // after midnight or refreshes too often. 2,880 runs against D1 take about 4 s here and 12 s
  // on a CI runner, so the default 5 s timeout is too short.
  it('serves every source near its interval for two days, with one adapter per run', {
    timeout: 60_000,
  }, async () => {
    const hour = 60 * minute;
    const start = Date.UTC(2026, 8, 19, 12);
    const failing = { from: start + 6 * hour, to: start + 12 * hour };
    const midnights = [Date.UTC(2026, 8, 19, 23), Date.UTC(2026, 8, 21)] as const;
    const historyFailing = { from: midnights[1] - 10 * minute, to: midnights[1] + minute };
    const attempts = new Map<SourceId, number[]>();
    let run = 0;
    let weatherFailures = 0;
    let monkeytypeKeyed = 0;
    const history = historyStandIn();
    const adapters = standIns(async (id) => {
      attempts.set(id, [...(attempts.get(id) ?? []), run]);
      const now = Date.now();
      if (id === 'weather' && now >= failing.from && now < failing.to) {
        if (++weatherFailures % 3 === 0) {
          vi.setSystemTime(now + 20_000);
          throw new DOMException('timed out', 'TimeoutError');
        }
        throw Object.assign(new Error('429'), { code: 'upstream_rate_limited' });
      }
      if (id === 'listening-history') {
        return history.part(now >= historyFailing.from && now < historyFailing.to);
      }
      if (id === 'monkeytype' && now < start + 24 * hour) {
        throw Object.assign(new Error('no key'), { code: 'not_configured' });
      }
      if (id === 'monkeytype' && ++monkeytypeKeyed === 1) {
        throw Object.assign(new Error('479'), { code: 'upstream_rate_limited' });
      }
      return {};
    });
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      for (run = 0; run < 2 * 24 * 60; run++) {
        const scheduledTime = start + run * minute;
        // The trigger fires a moment after its scheduled minute.
        vi.setSystemTime(scheduledTime + 1500);
        const before = adapters.reduce((sum, a) => sum + a.calls, 0);
        await runScheduled(env, adapters, scheduledTime);
        expect(adapters.reduce((sum, a) => sum + a.calls, 0) - before, `run ${run}`).toBe(1);
      }
    } finally {
      vi.useRealTimers();
    }

    const gaps = new Map(
      [...attempts].map(([id, runs]) => [id, runs.slice(1).map((r, i) => r - (runs[i] ?? 0))])
    );
    for (const { id, intervalSeconds } of pullAdapters) {
      const runs = attempts.get(id) ?? [];
      // Every source is tried in the first minutes, and again within its interval plus 5,
      // up to the end of the two days: the daily one too, so each is tried more than once.
      expect(runs[0], id).toBeLessThan(pullAdapters.length);
      expect(runs.length, id).toBeGreaterThan(1);
      // The activity pull also waits out the first 15 minutes of a date in Rabat (ADR 0038).
      const limit =
        id === 'listening' ? 5 : intervalSeconds / 60 + (id === 'shipping-activity' ? 20 : 5);
      const [first = 0, ...later] = gaps.get(id) ?? [];
      // At startup listening waits while each of the other six sources is tried once (ADR
      // 0038): measured 7 minutes, then at most 3.
      expect(first, id).toBeLessThanOrEqual(id === 'listening' ? 7 : limit);
      expect(Math.max(...later), id).toBeLessThanOrEqual(limit);
      expect(run - (runs.at(-1) ?? 0), `${id} at the end`).toBeLessThanOrEqual(limit);
    }
    expect(weatherFailures).toBeGreaterThan(0);
    // Tried with a key after the refusal, and stored.
    expect(monkeytypeKeyed).toBeGreaterThan(1);
    const weather = await fetchApi('/v1/weather').then((r) => r.json());
    expect(weather).toMatchObject({ data: { normalized: {} } });
    // Each new Rabat date has its history within 10 minutes with Last.fm answering, and 5
    // minutes later when its first attempt of the date fails. No date has more than four.
    for (const [midnight, bound] of [
      [midnights[0], 10 * minute],
      [midnights[1], 15 * minute],
    ] as const) {
      const first = history.published.find((at) => at >= midnight) ?? Number.POSITIVE_INFINITY;
      expect(first - midnight, new Date(midnight).toISOString()).toBeLessThanOrEqual(bound);
    }
    const perDate = Map.groupBy(history.published, (at) => rabatDate(at));
    expect(Math.max(...[...perDate.values()].map((d) => d.length))).toBeLessThanOrEqual(4);
  });

  // Every source due at Rabat's midnight, the history's last attempt at 23:58 (a success or a
  // failure), and the triggers at 00:02 and 00:03 lost to a deploy, at +01 and at +00.
  // Catches a history that waits for its 7 hours, or behind the other sources, on a new date.
  it.each([
    ['+01', 'a success', Date.UTC(2026, 8, 19, 23)],
    ['+01', 'a failure', Date.UTC(2026, 8, 19, 23)],
    ['+00', 'a success', Date.UTC(2026, 9, 27)],
    ['+00', 'a failure', Date.UTC(2026, 9, 27)],
  ])(
    'publishes the history within 10 minutes 2.3 seconds of midnight at %s, after %s at 23:58',
    async (_, last, midnight) => {
      const store = new D1SnapshotStore(env.DB);
      for (const { id, intervalSeconds } of pullAdapters) {
        const at = new Date(
          midnight - (id === 'listening-history' ? 2 * minute : intervalSeconds * 1000)
        );
        if (id === 'listening-history' && last === 'a failure') {
          await store.recordFailure(id, 'upstream_error', at.toISOString());
        } else await store.put(id, {}, at.toISOString());
      }
      const history = historyStandIn();
      const adapters = standIns(async (id) => (id === 'listening-history' ? history.part() : {}));
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        for (let run = 0; run < 15; run++) {
          if (run === 2 || run === 3) continue;
          vi.setSystemTime(midnight + run * minute + 1500);
          await runScheduled(env, adapters, midnight + run * minute);
        }
      } finally {
        vi.useRealTimers();
      }
      // Measured 10 minutes 2.3 seconds with six sources (ADR 0033), 9 minutes 2.3 seconds
      // with five: the history waits one more minute while Monkeytype is pulled. The seventh,
      // the activity pull, waits out these minutes (ADR 0038), so it adds none.
      expect((history.published[0] ?? Number.POSITIVE_INFINITY) - midnight).toBeLessThanOrEqual(
        10 * minute + 2_300
      );
    }
  );

  it('records a failure as a code, keeps the last good snapshot and never logs the message', async () => {
    const start = Date.now();
    await runScheduled(env, [adapter('projects', 60)], start);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const failing = adapter('projects', 60, async () => {
      throw Object.assign(new Error('GET https://api.github.com?token=ghp_secret: 502 <html>'), {
        code: 'upstream_5xx',
      });
    });
    const untyped = adapter('shipping', 60, async () => {
      throw new Error('token=abc in message');
    });
    await runScheduled(env, [failing, untyped], start + minute);
    await runScheduled(env, [failing, untyped], start + 2 * minute);

    const health = await fetchApi('/v1/health').then((r) =>
      r.json<{ sources: { source: string; lastErrorCode: string | null }[] }>()
    );
    expect(health.sources.find((s) => s.source === 'projects')?.lastErrorCode).toBe('upstream_5xx');
    expect(health.sources.find((s) => s.source === 'shipping')?.lastErrorCode).toBe('fetch_failed');
    expect(await fetchApi('/v1/projects').then((r) => r.json())).toMatchObject({
      data: { normalized: { id: 'projects' } },
    });
    const logs = JSON.stringify(warn.mock.calls);
    expect(logs).toContain('upstream_5xx');
    expect(logs).not.toMatch(/ghp_secret|token=|<html>/);
    warn.mockRestore();
  });

  it('deletes push deliveries older than 7 days, in batches, and keeps newer ones', async () => {
    const now = Date.now();
    const old = now - 7 * 24 * 3600_000 - 1;
    const insert = env.DB.prepare(
      "INSERT INTO push_deliveries (producer, delivery_id, body_sha256, received_at) VALUES ('trellis', ?, 'h', ?)"
    );
    const rows = Array.from({ length: 1201 }, (_, i) => insert.bind(`old-${i}`, old - i));
    await env.DB.batch([...rows, insert.bind('recent', now - 1000)]);

    await runScheduled(env, [], now);

    expect(await deliveryRows()).toEqual([expect.objectContaining({ delivery_id: 'recent' })]);
  });
});
