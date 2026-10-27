// Monkeytype personal bests (ADR 0033): the ApeKey's path out of the Worker, and whole pulls
// through the real runner and D1, with Monkeytype mocked at the network. A request no
// handler answers fails instead of reaching the internet.
import { env } from 'cloudflare:workers';
import { rawFixtures, snapshotFixtures } from '@min7/contracts/fixtures';
import { upstreamHandlers } from '@min7/contracts/testing';
import { setupNetwork } from '@msw/cloudflare';
import { delay, HttpResponse, http, type RequestHandler } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PullError } from '../src/adapters/pull/index.ts';
import { monkeytype } from '../src/adapters/pull/monkeytype.ts';
import { runScheduled } from '../src/cron/run.ts';
import { clearState, fetchApi, snapshotRow } from './helpers.ts';

const network = setupNetwork();
network.configure({ onUnhandledFrame: 'error' });
beforeAll(() => network.enable());
afterEach(() => {
  network.resetHandlers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
afterAll(() => network.disable());
beforeEach(clearState);

// Obviously fake.
const apeKey = 'fake-monkeytype-ape-key-0000000000';
const withKey = { ...env, MONKEYTYPE_APE_KEY: apeKey };
const endpoint = 'https://api.monkeytype.com/users/personalBests';
const signal = () => AbortSignal.timeout(2_000);
const at = (iso: string) => Date.parse(iso);

interface Seen {
  url: string;
  host: string;
  authorization: string | null;
  userAgent: string | null;
}

/** Every request the Worker makes, to any host, answered by `handlers`. */
function recordRequests(...handlers: RequestHandler[]) {
  const seen: Seen[] = [];
  // Handlers added later run first: the recorder sees each request, then passes it on.
  network.use(...handlers);
  network.use(
    http.all('*', ({ request }) => {
      seen.push({
        url: request.url,
        host: new URL(request.url).host,
        authorization: request.headers.get('authorization'),
        userAgent: request.headers.get('user-agent'),
      });
    })
  );
  return seen;
}

async function pullError(promise: Promise<unknown>): Promise<PullError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason
  );
  expect(error).toBeInstanceOf(PullError);
  return error as PullError;
}

/** Collects every console line the Worker writes while `run` runs. */
async function logged(run: () => Promise<unknown>): Promise<string> {
  const spies = [
    vi.spyOn(console, 'log').mockImplementation(() => {}),
    vi.spyOn(console, 'warn').mockImplementation(() => {}),
    vi.spyOn(console, 'error').mockImplementation(() => {}),
  ];
  await run();
  return JSON.stringify(spies.map((spy) => spy.mock.calls));
}

const health = async () =>
  (
    await fetchApi('/v1/health').then((r) =>
      r.json<{ sources: { source: string; lastErrorCode: string | null }[] }>()
    )
  ).sources.find((s) => s.source === 'monkeytype');

/** What /v1/monkeytype serves now, past the edge cache. */
const served = async () => {
  await caches.default.delete('https://api.ayagmar.dev/v1/monkeytype');
  return fetchApi('/v1/monkeytype').then((r) =>
    r.json<{ fetchedAt: string | null; stale: boolean; data: unknown }>()
  );
};

/** Runs the cron at each of `times` (ISO, a trigger's scheduled minute), as a fresh runner. */
async function cron(times: string[], environment: Env = withKey) {
  vi.useFakeTimers({ toFake: ['Date'] });
  for (const time of times) {
    vi.setSystemTime(at(time) + 1500);
    await runScheduled(environment, [monkeytype], at(time));
  }
}

describe('the ApeKey', () => {
  // Catches the key in a URL (Workers traces record them), sent to another host, a third
  // request, or a pull without a User-Agent.
  it('goes to api.monkeytype.com only, in a header, on two requests one after the other', async () => {
    const seen = recordRequests(...upstreamHandlers());
    expect(await monkeytype.fetch(withKey, signal())).toEqual(rawFixtures.monkeytype.ok);
    expect(seen.map((r) => r.url)).toEqual([`${endpoint}?mode=time`, `${endpoint}?mode=words`]);
    for (const request of seen) {
      expect(request.authorization).toBe(`ApeKey ${apeKey}`);
      expect(request.userAgent).toBe('min7-signals (+https://ayagmar.dev)');
    }
  });

  it('asks for nothing when it is not set, or empty', async () => {
    const seen = recordRequests(...upstreamHandlers());
    for (const environment of [env, { ...env, MONKEYTYPE_APE_KEY: '' }]) {
      expect((await pullError(monkeytype.fetch(environment, signal()))).code).toBe(
        'not_configured'
      );
    }
    expect(seen).toEqual([]);
  });

  it('is refused once: words is not asked after time fails', async () => {
    const seen = recordRequests(...upstreamHandlers({ monkeytype: 'missing' }));
    const raw = await monkeytype.fetch(withKey, signal());
    expect(seen).toHaveLength(1);
    expect(raw).toEqual(rawFixtures.monkeytype.missing);
  });

  // Workers follows a redirect with every header, `Authorization` included, even to another
  // host. Catches a followed redirect of any kind.
  it.each([
    ['the same host', `${endpoint}?mode=time&again=1`],
    ['another host', 'https://example.com/collect'],
    ['plain HTTP', 'http://api.monkeytype.com/users/personalBests?mode=time'],
  ])('never follows a redirect to %s', async (_case, location) => {
    const seen = recordRequests(
      http.get(endpoint, () => new HttpResponse(null, { status: 302, headers: { location } })),
      http.all('*', () => HttpResponse.json({ data: null }))
    );
    const raw = await monkeytype.fetch(withKey, signal());
    expect(seen.map((r) => r.url)).toEqual([`${endpoint}?mode=time`]);
    expect(raw).toMatchObject({ time: { status: 302 }, words: null });
    expect((await pullError(Promise.resolve().then(() => monkeytype.normalize(raw)))).code).toBe(
      'upstream_http_error'
    );
  });

  it('gives up on a body that stops after its headers', { timeout: 10_000 }, async () => {
    network.use(
      http.get(
        endpoint,
        () =>
          new HttpResponse(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode('{"data":{'));
              },
            }),
            { headers: { 'content-type': 'application/json' } }
          )
      )
    );
    const started = Date.now();
    expect((await pullError(monkeytype.fetch(withKey, AbortSignal.timeout(20_000)))).code).toBe(
      'upstream_timeout'
    );
    // getJson's own 5-second deadline covers the body.
    expect(Date.now() - started).toBeLessThan(7_000);
  });

  it('stops reading a body over 128 KiB, sent in chunks without a length', async () => {
    const chunk = new TextEncoder().encode('x'.repeat(16 * 1024));
    network.use(
      http.get(
        endpoint,
        () =>
          new HttpResponse(
            new ReadableStream({
              start(controller) {
                for (let i = 0; i < 9; i++) controller.enqueue(chunk);
                controller.close();
              },
            })
          )
      )
    );
    expect((await pullError(monkeytype.fetch(withKey, signal()))).code).toBe('upstream_too_large');
  });

  it('gives up when Monkeytype does not answer in time', async () => {
    network.use(
      http.get(endpoint, async () => {
        await delay('infinite');
      })
    );
    expect((await pullError(monkeytype.fetch(withKey, AbortSignal.timeout(50)))).code).toBe(
      'upstream_timeout'
    );
  });
});

describe('a pull through the runner', () => {
  // Catches an identifier from the answer kept anywhere: in D1, the read API or a log line.
  it('stores and serves the bests, and none of the identifiers around them', async () => {
    network.use(...upstreamHandlers({ monkeytype: 'sensitive-fields' }));
    const logs = await logged(() => cron(['2026-10-27T00:00:00Z']));
    const row = await snapshotRow('monkeytype');
    const body = await served();
    expect(body).toMatchObject({
      fetchedAt: '2026-10-27T00:00:01.500Z',
      stale: false,
      data: snapshotFixtures.monkeytype['sensitive-fields'],
    });
    for (const text of [JSON.stringify(row), JSON.stringify(body), logs]) {
      expect(text).not.toMatch(
        /fake-uid|fake-monkeytype-name|fake@example|fake-ape-key-id|fake-tag|fake-nested/
      );
      expect(text).not.toContain(apeKey);
    }
  });

  // Catches a half-read pull published as new: time answered, words did not.
  it('keeps the whole last snapshot, and its time, when either mode fails', async () => {
    network.use(...upstreamHandlers());
    await cron(['2026-10-27T00:00:00Z']);
    const before = await served();
    network.resetHandlers();
    network.use(
      http.get(endpoint, ({ request }) =>
        new URL(request.url).searchParams.get('mode') === 'words'
          ? HttpResponse.json({ message: 'down' }, { status: 503 })
          : HttpResponse.json(rawFixtures.monkeytype.partial.time.body)
      )
    );
    await cron(['2026-10-27T06:00:00Z']);
    expect(await health()).toMatchObject({ lastErrorCode: 'upstream_http_error' });
    expect(await served()).toEqual(before);
  });

  // Catches a revoked key that wipes the bests, or puts the key or Monkeytype's words in a log.
  it('keeps the bests when the key is refused, and logs a fixed code only', async () => {
    network.use(...upstreamHandlers());
    await cron(['2026-10-27T00:00:00Z']);
    network.resetHandlers();
    network.use(
      http.get(endpoint, () =>
        HttpResponse.json({ message: `ApeKey ${apeKey} is inactive` }, { status: 471 })
      )
    );
    const logs = await logged(() => cron(['2026-10-27T06:00:00Z']));
    expect(await health()).toMatchObject({ lastErrorCode: 'upstream_unauthorized' });
    expect(logs).toContain('upstream_unauthorized');
    expect(logs).not.toContain(apeKey);
    expect(logs).not.toContain('inactive');
    expect((await served()).data).toEqual(snapshotFixtures.monkeytype.ok);
  });

  // Catches an unset key that empties the section or freshens its age, or that is tried every
  // minute instead of at the pull interval. Each attempt logs one line.
  it('without a key, asks nothing, keeps what it had and says so once per attempt', async () => {
    network.use(...upstreamHandlers());
    await cron(['2026-10-27T00:00:00Z']);
    const before = await served();
    const seen = recordRequests(...upstreamHandlers());
    const minutes = Array.from({ length: 7 * 60 }, (_, i) =>
      new Date(at('2026-10-27T06:00:00Z') + i * 60_000).toISOString()
    );
    const logs = await logged(() => cron(minutes, env));
    expect(seen).toEqual([]);
    expect(logs.match(/not_configured/g)).toHaveLength(2);
    expect(await served()).toEqual(before);
  });
});

describe("Monkeytype's Retry-After", () => {
  const refused = (status: number, headers: Record<string, string> = {}) =>
    http.get(endpoint, () =>
      HttpResponse.json({ message: 'ApeKey rate limit exceeded' }, { status, headers })
    );

  /** The triggers (scheduled minutes, ISO) at which Monkeytype was asked, as `HH:MM`. */
  async function asked(seen: Seen[], times: string[]) {
    const minutes: string[] = [];
    for (const time of times) {
      const before = seen.length;
      await cron([time]);
      if (seen.length > before) minutes.push(time.slice(11, 16));
    }
    return minutes;
  }

  /** Triggers every `stepMinutes` from `from`, `count` in all. */
  const triggers = (from: string, count: number, stepMinutes = 1) =>
    Array.from({ length: count }, (_, i) =>
      new Date(at(from) + i * stepMinutes * 60_000).toISOString()
    );

  // Catches a retry before the time Monkeytype named, past the 6-hour interval, in both of
  // Retry-After's forms and for both refusals, by a runner that starts afresh each minute as a
  // cron invocation does. The 07:00 trigger is inside the runner's 30-second early allowance
  // for that time, and still waits.
  it.each([
    [429, 'seconds', '25200'],
    [429, 'an HTTP date', 'Tue, 27 Oct 2026 07:00:30 GMT'],
    [479, 'seconds', '25200'],
    [479, 'an HTTP date', 'Tue, 27 Oct 2026 07:00:30 GMT'],
  ])('%i waits until the time it gives as %s', async (status, _form, value) => {
    const seen = recordRequests(refused(status, { 'Retry-After': value }));
    const times = ['2026-10-27T00:00:00Z', ...triggers('2026-10-27T05:59:00Z', 64)];
    expect(await asked(seen, times)).toEqual(['00:00', '07:01']);
    expect(await health()).toMatchObject({ lastErrorCode: 'upstream_rate_limited' });
  });

  // Catches a refusal without a usable header retried every minute, or never.
  it.each([
    [429, 'no header', {}],
    [429, 'a header it cannot read', { 'Retry-After': 'soon' }],
    [429, 'a time already past', { 'Retry-After': 'Mon, 26 Oct 2026 00:00:00 GMT' }],
    [479, 'no header', {}],
    [479, 'a header it cannot read', { 'Retry-After': 'soon' }],
    [479, 'a time already past', { 'Retry-After': 'Mon, 26 Oct 2026 00:00:00 GMT' }],
  ])('%i falls back to the 6-hour interval with %s', async (status, _case, headers) => {
    const seen = recordRequests(refused(status, headers));
    expect(await asked(seen, triggers('2026-10-27T00:00:00Z', 8, 60))).toEqual(['00:00', '06:00']);
  });
});
