import { createScheduledController } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { SourceId } from '@min7/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pullAdapters } from '../src/adapters/pull/index.ts';
import type { PullAdapter } from '../src/adapters/types.ts';
import { runScheduled } from '../src/cron/run.ts';
import worker from '../src/index.ts';
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

  // Two days of minute triggers with the real registry's sources and intervals (ADR 0029).
  // Both clocks move: the trigger's scheduledTime, and Date, which stamps each stored attempt.
  // Fetches take time, and weather fails for six hours, every third failure hanging until the
  // runner's 20 s timeout. Catches a source starved by the others, a failing one hogging the
  // slot, or two adapters sharing an invocation.
  it('serves every source near its interval for two days, with one adapter per run', async () => {
    const hour = 60 * minute;
    const start = Date.UTC(2026, 9, 26);
    const failing = { from: start + 6 * hour, to: start + 12 * hour };
    const durationMs: Partial<Record<SourceId, number>> = {
      listening: 1500,
      shipping: 900,
      projects: 8000,
      weather: 700,
    };
    const attempts = new Map<SourceId, number[]>();
    let run = 0;
    let weatherFailures = 0;
    const adapters = pullAdapters.map(({ id, intervalSeconds }) =>
      adapter(id, intervalSeconds, async () => {
        attempts.set(id, [...(attempts.get(id) ?? []), run]);
        vi.setSystemTime(Date.now() + (durationMs[id] ?? 1000));
        const now = Date.now();
        if (id === 'weather' && now >= failing.from && now < failing.to) {
          if (++weatherFailures % 3 === 0) {
            vi.setSystemTime(now + 20_000);
            throw new DOMException('timed out', 'TimeoutError');
          }
          throw Object.assign(new Error('429'), { code: 'upstream_rate_limited' });
        }
        return {};
      })
    );
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
      // Every source is tried in the first minutes, and again within its interval plus 5.
      expect(runs[0], id).toBeLessThan(pullAdapters.length);
      const limit = id === 'listening' ? 5 : intervalSeconds / 60 + 5;
      expect(Math.max(...(gaps.get(id) ?? [])), id).toBeLessThanOrEqual(limit);
    }
    expect(weatherFailures).toBeGreaterThan(0);
    const weather = await fetchApi('/v1/weather').then((r) => r.json());
    expect(weather).toMatchObject({ data: { normalized: {} } });
  });

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
