import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { staleAfterSeconds } from '@min7/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/app.ts';
import { clearState, fetchApi } from './helpers.ts';

beforeEach(clearState);

const site = 'https://ayagmar.dev';

/** Stores a pulled snapshot fetched `ageMs` ago, as the cron would. */
const seed = (source: string, data: unknown, ageMs: number) => {
  const at = new Date(Date.now() - ageMs).toISOString();
  return env.DB.prepare(
    'INSERT OR REPLACE INTO snapshots (source, json, fetched_at, last_success_at) VALUES (?, ?, ?, ?)'
  )
    .bind(source, JSON.stringify(data), at, at)
    .run();
};

const get = (path: string, origin?: string, method = 'GET') =>
  fetchApi(path, { method, headers: origin ? { Origin: origin } : {} });

describe('read API', () => {
  it('serves a never-succeeded source as stale with null data', async () => {
    const response = await get('/v1/shelf');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      source: 'shelf',
      version: 1,
      fetchedAt: null,
      stale: true,
      data: null,
    });
  });

  it('computes stale from fetchedAt and the source threshold when serving', async () => {
    const threshold = staleAfterSeconds.projects * 1000;
    await seed('projects', { n: 1 }, threshold + 1000);
    await seed('shipping', { n: 2 }, 1000);

    expect((await get('/v1/projects').then((r) => r.json<{ stale: boolean }>())).stale).toBe(true);
    expect((await get('/v1/shipping').then((r) => r.json<{ stale: boolean }>())).stale).toBe(false);
  });

  it('answers HEAD like GET without a body', async () => {
    await seed('listening', { track: 'x' }, 1000);
    const head = await get('/v1/listening', site, 'HEAD');

    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    expect(head.headers.get('access-control-allow-origin')).toBe(site);
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('answers %s with 405', async (method) => {
    const response = await get('/v1/listening', site, method);

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, HEAD, OPTIONS');
  });
});

describe('CORS and the edge cache', () => {
  it('serves one cached copy to every origin, with CORS only for the site', async () => {
    await seed('listening', { track: 'first' }, 1000);
    const anonymous = await get('/v1/listening');
    // The cached copy is served from now on, whatever D1 says.
    await seed('listening', { track: 'second' }, 1000);
    const fromSite = await get('/v1/listening', site);
    const fromOther = await get('/v1/listening', 'https://evil.example');
    const fromWww = await get('/v1/listening', 'https://www.ayagmar.dev');

    for (const response of [anonymous, fromSite, fromOther, fromWww]) {
      expect(await response.json()).toMatchObject({ data: { track: 'first' } });
      expect(response.headers.get('vary')).toBe('Origin');
      expect(response.headers.get('cache-control')).toMatch(/^public, max-age=([1-9]|[1-5]\d|60)$/);
      expect(response.headers.get('x-min7-expires-at')).toBeNull();
    }
    expect(anonymous.headers.get('access-control-allow-origin')).toBeNull();
    expect(fromSite.headers.get('access-control-allow-origin')).toBe(site);
    expect(fromOther.headers.get('access-control-allow-origin')).toBeNull();
    expect(fromWww.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('does not let a site request warm the cache with its CORS header', async () => {
    await seed('listening', { track: 'first' }, 1000);
    await get('/v1/listening', site);
    const later = await get('/v1/listening', 'https://evil.example');

    expect(later.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('answers a preflight from the site only, and never caches it', async () => {
    const fromSite = await get('/v1/listening', site, 'OPTIONS');
    const fromOther = await get('/v1/listening', 'https://evil.example', 'OPTIONS');

    expect(fromSite.status).toBe(204);
    expect(fromSite.headers.get('access-control-allow-origin')).toBe(site);
    expect(fromSite.headers.get('access-control-allow-methods')).toBe('GET, HEAD, OPTIONS');
    expect(fromSite.headers.get('cache-control')).toBe('no-store');
    expect(fromOther.headers.get('access-control-allow-origin')).toBeNull();
  });

  it.each(['listening', 'weather'] as const)(
    'never serves a cached %s copy past the moment it turns stale',
    async (source) => {
      const threshold = staleAfterSeconds[source] * 1000;
      await seed(source, { n: 1 }, threshold - 1500);
      const fresh = await get(`/v1/${source}`);
      expect(await fresh.json()).toMatchObject({ stale: false });
      expect(fresh.headers.get('cache-control')).toBe('public, max-age=1');

      await new Promise((resolve) => setTimeout(resolve, 2000));
      expect(await get(`/v1/${source}`).then((r) => r.json())).toMatchObject({ stale: true });
    }
  );

  // Weather is pulled every 15 minutes, but a new snapshot must still reach the browser within
  // a minute (ADR 0010), and the room's own expiry needs a fresh `stale` (ADR 0029).
  it('caches weather for a minute at most, like every source', async () => {
    await seed('weather', { n: 1 }, 1000);
    const response = await get('/v1/weather', site);

    expect(response.headers.get('cache-control')).toBe('public, max-age=60');
    expect(response.headers.get('access-control-allow-origin')).toBe(site);
    expect(await response.json()).toMatchObject({
      source: 'weather',
      stale: false,
      data: { n: 1 },
    });
  });

  it('does not cache an error', async () => {
    await seed('listening', { track: 'x' }, 1000);
    await env.DB.exec('ALTER TABLE snapshots RENAME TO snapshots_hidden');
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failed = await get('/v1/listening');
    await env.DB.exec('ALTER TABLE snapshots_hidden RENAME TO snapshots');
    logged.mockRestore();

    expect(failed.status).toBe(500);
    expect(failed.headers.get('cache-control')).toBe('no-store');
    expect(await failed.json()).toEqual({ error: 'internal_error' });
    expect(await get('/v1/listening').then((r) => r.json())).toMatchObject({
      data: { track: 'x' },
    });
  });
});

describe('health', () => {
  it('reports the commit and, per source, last success, staleness and the last error code', async () => {
    await seed('listening', { track: 'x' }, 1000);
    await env.DB.prepare(
      "INSERT INTO snapshots (source, last_error_code, last_attempt_at) VALUES ('projects', 'upstream_5xx', 0)"
    ).run();

    const response = await get('/v1/health', site);
    const body = await response.json<{ version: string; sources: unknown[] }>();

    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('access-control-allow-origin')).toBe(site);
    expect(body.version).toBe('test-sha');
    expect(body.sources).toEqual([
      { source: 'listening', lastSuccessAt: expect.any(String), stale: false, lastErrorCode: null },
      { source: 'shipping', lastSuccessAt: null, stale: true, lastErrorCode: null },
      { source: 'projects', lastSuccessAt: null, stale: true, lastErrorCode: 'upstream_5xx' },
      { source: 'llm-usage', lastSuccessAt: null, stale: true, lastErrorCode: null },
      { source: 'shelf', lastSuccessAt: null, stale: true, lastErrorCode: null },
      { source: 'weather', lastSuccessAt: null, stale: true, lastErrorCode: null },
      { source: 'listening-history', lastSuccessAt: null, stale: true, lastErrorCode: null },
      { source: 'desktop', lastSuccessAt: null, stale: true, lastErrorCode: null },
      { source: 'monkeytype', lastSuccessAt: null, stale: true, lastErrorCode: null },
    ]);
  });
});

describe('freshness against a slow read', () => {
  let clock = 0;
  beforeEach(() => {
    clock = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => clock);
  });
  afterEach(() => vi.restoreAllMocks());

  const read = async (db: D1Database = env.DB) => {
    const ctx = createExecutionContext();
    const response = await app.fetch(
      new Request('https://api.ayagmar.dev/v1/listening'),
      { ...env, DB: db },
      ctx
    );
    await waitOnExecutionContext(ctx);
    return response;
  };

  /** A database whose reads take `delayMs` of clock time. */
  const slow = (delayMs: number) =>
    new Proxy(env.DB, {
      get(target, property) {
        if (property !== 'prepare') return Reflect.get(target, property);
        return (sql: string) => ({
          bind: (...values: unknown[]) => ({
            first: async () => {
              const row = await target
                .prepare(sql)
                .bind(...values)
                .first();
              clock += delayMs;
              return row;
            },
          }),
        });
      },
    });

  const seedNearStale = () => {
    const at = new Date(clock - staleAfterSeconds.listening * 1000 + 1500).toISOString();
    return env.DB.prepare(
      'INSERT INTO snapshots (source, json, fetched_at, last_success_at) VALUES (?, ?, ?, ?)'
    )
      .bind('listening', '{"track":"x"}', at, at)
      .run();
  };

  it('computes stale after the D1 read, not before it', async () => {
    await seedNearStale();
    const response = await read(slow(2200));

    expect(await response.json()).toMatchObject({ stale: true });
    expect(response.headers.get('cache-control')).not.toBe('public, max-age=1');
  });

  it('does not serve a cached copy past its own expiry', async () => {
    await seedNearStale();
    expect(await (await read()).json()).toMatchObject({ stale: false });

    // The edge cache still holds the copy; signals' own clock says it has expired.
    clock += 5000;
    expect(await (await read()).json()).toMatchObject({ stale: true });
  });
});
