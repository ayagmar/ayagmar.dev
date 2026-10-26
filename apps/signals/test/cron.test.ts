import { createScheduledController } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { SourceId } from '@min7/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

  it('pulls an adapter again only once its interval has passed', async () => {
    const listening = adapter('listening', 60);
    const projects = adapter('projects', 24 * 3600);
    const start = Date.now();

    for (let run = 0; run < 3; run++) {
      await runScheduled(env, [listening, projects], start + run * minute);
    }
    // The stored attempt time is the fetch time, a little after the first scheduled time.
    expect(listening.calls).toBe(3);
    expect(projects.calls).toBe(1);
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

  it('fetches at most four adapters at a time', async () => {
    let inFlight = 0;
    let most = 0;
    const slow: PullAdapter['fetch'] = async () => {
      most = Math.max(most, ++inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return {};
    };
    const ids: SourceId[] = ['listening', 'shipping', 'projects', 'llm-usage', 'shelf'];
    await runScheduled(
      env,
      ids.map((id) => adapter(id, 60, slow)),
      Date.now()
    );
    expect(most).toBe(4);
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
