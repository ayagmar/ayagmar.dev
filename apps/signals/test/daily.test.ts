// Daily history (ADR 0038): the activity pull through the cron, `/v1/days`, the llm-usage push's
// days, and the rule for a day over generated sequences of pulls, failures and interruptions.
import { env } from 'cloudflare:workers';
import {
  type LlmUsageDay,
  llmUsageDaysEnvelopeSchema,
  type RepoPulseActivity,
  shippingActivityDaysEnvelopeSchema,
} from '@min7/contracts';
import { daysFixtures, pushFixtures, rawFixtures } from '@min7/contracts/fixtures';
import { upstreamHandlers } from '@min7/contracts/testing';
import { setupNetwork } from '@msw/cloudflare';
import { HttpResponse, http } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { shippingActivity } from '../src/adapters/pull/shipping-activity.ts';
import { runScheduled } from '../src/cron/run.ts';
import { admitPush } from '../src/storage/admission.ts';
import { clearState, delivery, fetchApi, forgetLastPush, push } from './helpers.ts';

const network = setupNetwork();
network.configure({ onUnhandledFrame: 'error' });
beforeAll(() => network.enable());
afterEach(() => {
  network.resetHandlers();
  vi.useRealTimers();
});
afterAll(() => network.disable());
beforeEach(clearState);

const hour = 60 * 60_000;
const activityUrl = 'https://repo-pulse.ayagmar.workers.dev/public/activity';
const okAnswer = rawFixtures['repo-pulse-activity'].ok.body as RepoPulseActivity;
/** Just after the `ok` answer was generated (2026-10-26T08:55Z). */
const capturedAt = Date.parse('2026-10-26T09:00:00Z');

/** Sets the clock to `at` and runs the activity pull through the cron. */
async function pullAt(at: number) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(at);
  await runScheduled(env, [shippingActivity], at);
}

/** Answers the activity route with `body` (HTTP 200). */
const answer = (body: unknown) =>
  network.use(http.get(activityUrl, () => HttpResponse.json(body as object)));

const copy = <T>(value: T): T => structuredClone(value);

const rows = async (source = 'shipping-activity') =>
  (
    await env.DB.prepare('SELECT day, json, fetched_at FROM daily WHERE source = ? ORDER BY day')
      .bind(source)
      .all<{ day: string; json: string; fetched_at: string }>()
  ).results;

const health = async () =>
  (
    await fetchApi('/v1/health').then((r) =>
      r.json<{ sources: { source: string; lastErrorCode: string | null }[] }>()
    )
  ).sources.find((s) => s.source === 'shipping-activity');

const days = async (series: string, query: string) => {
  const response = await fetchApi(`/v1/days/${series}?${query}`);
  return { response, body: await response.json<{ fetchedAt: string | null; data: unknown }>() };
};

describe('the activity pull', () => {
  it('stores the days from `since` on and serves them as the site reads them', async () => {
    network.use(...upstreamHandlers());
    await pullAt(capturedAt);

    const { response, body } = await days('shipping-activity', 'last=28');
    expect(response.status).toBe(200);
    expect(body).toEqual({
      source: 'shipping-activity',
      version: 1,
      fetchedAt: '2026-10-26T08:55:00.000Z',
      stale: false,
      data: daysFixtures['shipping-activity'].ok,
    });
    shippingActivityDaysEnvelopeSchema.parse(body);
    // Nothing before `since` (2026-10-12) is stored: those days were not recorded.
    expect((await rows()).map((row) => row.day)[0]).toBe('2026-10-12');
    expect(await rows()).toHaveLength(15);
    expect((await health())?.lastErrorCode).toBeNull();
  });

  it('stores nothing, and succeeds, while repo-pulse has recorded nothing', async () => {
    network.use(...upstreamHandlers({ repoPulseActivity: 'since-null' }));
    await pullAt(capturedAt);

    expect(await rows()).toEqual([]);
    expect((await health())?.lastErrorCode).toBeNull();
    expect((await days('shipping-activity', 'last=28')).body.data).toMatchObject({ days: [] });
  });

  it.each([
    ['missing', 'upstream_not_found'],
    ['unavailable', 'upstream_http_error'],
    ['malformed', 'upstream_malformed'],
    ['incomplete', 'upstream_incomplete'],
  ] as const)('keeps what it had when the answer is %s (%s)', async (name, code) => {
    network.use(...upstreamHandlers());
    await pullAt(capturedAt);
    const before = await rows();

    network.use(...upstreamHandlers({ repoPulseActivity: name }));
    await pullAt(capturedAt + 2 * hour);

    expect(await rows()).toEqual(before);
    expect((await health())?.lastErrorCode).toBe(code);
    expect((await days('shipping-activity', 'last=28')).body.fetchedAt).toBe(
      '2026-10-26T08:55:00.000Z'
    );
  });

  // An answer that is not the whole window would leave holes or misplaced days in history.
  const broken: [string, (body: RepoPulseActivity) => void][] = [
    ['a day missing', (body) => body.days.splice(200, 1)],
    ['one date twice', (body) => Object.assign(body.days[399] ?? {}, { date: '2026-10-25' })],
    ['a window ending the day before', (body) => (body.generatedAt = '2026-10-27T00:00:01Z')],
    ['counts that are not the sums', (body) => Object.assign(body.days[399] ?? {}, { merges: 99 })],
    [
      'repositories out of order',
      (body) => body.days.find((day) => day.repos.length > 1)?.repos.reverse(),
    ],
    ['no days at all', (body) => (body.days = [])],
  ];
  it.each(broken)('refuses an answer with %s, storing nothing', async (_case, breakIt) => {
    const body = copy(okAnswer);
    breakIt(body);
    answer(body);
    await pullAt(capturedAt);

    expect(await rows()).toEqual([]);
    expect((await health())?.lastErrorCode).toBe('upstream_malformed');
  });

  it('refuses an answer dated more than 5 minutes ahead of its clock', async () => {
    network.use(...upstreamHandlers());
    await pullAt(Date.parse('2026-10-26T08:49:00Z'));

    expect(await rows()).toEqual([]);
    expect((await health())?.lastErrorCode).toBe('upstream_malformed');
  });

  it('keeps the newer answer when an older one arrives after it', async () => {
    const newer = copy(okAnswer);
    newer.generatedAt = '2026-10-26T10:00:00.000Z';
    const today = newer.days[399];
    const repo = today?.repos[0];
    if (today === undefined || repo === undefined) throw new Error('fixture');
    today.pushes += 5;
    repo.pushes += 5;
    answer(newer);
    await pullAt(Date.parse('2026-10-26T10:01:00Z'));
    const stored = await rows();

    network.resetHandlers();
    network.use(...upstreamHandlers());
    await pullAt(Date.parse('2026-10-26T11:30:00Z'));

    expect(await rows()).toEqual(stored);
    expect((await health())?.lastErrorCode).toBeNull();
    expect((await days('shipping-activity', 'last=28')).body.fetchedAt).toBe(
      '2026-10-26T10:00:00.000Z'
    );
  });

  it('never lowers a day, and stops naming a repository repo-pulse no longer shows', async () => {
    network.use(...upstreamHandlers());
    await pullAt(capturedAt);
    const hidden = 'ayagmar/repo-pulse';
    const withIt = okAnswer.days.find((day) => day.repos.some((r) => r.repo === hidden));
    if (withIt === undefined) throw new Error('fixture');

    // Made private: gone from every day of the next answer, its counts with it.
    const later = copy(okAnswer);
    later.generatedAt = '2026-10-26T10:55:00.000Z';
    for (const day of later.days) {
      const gone = day.repos.filter((r) => r.repo === hidden);
      day.repos = day.repos.filter((r) => r.repo !== hidden);
      for (const key of ['pushes', 'commits', 'merges', 'releases', 'stars'] as const) {
        day[key] -= gone.reduce((sum, r) => sum + r[key], 0);
      }
    }
    network.resetHandlers();
    answer(later);
    await pullAt(Date.parse('2026-10-26T11:00:00Z'));

    const block = (await days('shipping-activity', 'month=2026-10')).body.data as {
      days: { date: string; pushes: number; repos: { repo: string }[]; reposComplete: boolean }[];
    };
    const served = block.days.find((day) => day.date === withIt.date);
    expect(served?.pushes).toBe(withIt.pushes);
    expect(served?.repos.map((r) => r.repo)).not.toContain(hidden);
    expect(served?.reposComplete).toBe(false);
    expect(JSON.stringify(block)).not.toContain(hidden);
  });
});

describe('GET /v1/days', () => {
  it.each([
    ['no block', ''],
    ['both blocks', 'last=28&month=2026-10'],
    ['another length', 'last=27'],
    ['an impossible month', 'month=2026-13'],
    ['a short month', 'month=2026-1'],
    ['a month before history', 'month=2024-12'],
    ['a month to come', 'month=2026-12'],
  ])('refuses %s with 400', async (_case, query) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(capturedAt);
    const { response, body } = await days('shipping-activity', query);
    expect(response.status).toBe(400);
    expect(body).toEqual({ error: 'invalid_query' });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('answers an unknown series with the JSON 404, and only reads', async () => {
    expect((await fetchApi('/v1/days/listening?last=28')).status).toBe(404);
    const post = await fetchApi('/v1/days/llm-usage?last=28', { method: 'POST' });
    expect(post.status).toBe(405);
    expect(post.headers.get('allow')).toBe('GET, HEAD, OPTIONS');
  });

  it('serves null until the series has succeeded once', async () => {
    const { response, body } = await days('llm-usage', 'last=28');
    expect(response.status).toBe(200);
    expect(body).toEqual({
      source: 'llm-usage',
      version: 1,
      fetchedAt: null,
      stale: true,
      data: null,
    });
  });
});

describe('llm-usage days from a push', () => {
  const ok = pushFixtures['llm-usage'].ok;
  type Day = LlmUsageDay;
  /** The `ok` push with its days replaced. */
  const withDays = (days: Day[], overrides: object = {}) =>
    delivery({ ...ok, payload: { ...ok.payload, days } }, overrides);
  const month = async () =>
    (
      (await days('llm-usage', 'month=2026-10')).body.data as {
        days: { date: string; totalTokens: number; costUsd: number | null }[];
      }
    ).days;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(capturedAt);
  });

  it('keeps the days of an accepted push, read back from the stored snapshot', async () => {
    expect((await push('llm-usage', delivery(ok))).status).toBe(202);

    const { body } = await days('llm-usage', 'month=2026-10');
    llmUsageDaysEnvelopeSchema.parse(body);
    expect(body.data).toMatchObject({ zone: 'Africa/Casablanca', from: '2026-10-01' });
    expect(await month()).toEqual(ok.payload.days);
  });

  it('writes nothing for a retry, a reused id or an older push', async () => {
    const first = delivery(ok);
    await push('llm-usage', first);
    const stored = await rows('llm-usage');
    await forgetLastPush('llm-usage');

    const bigger = ok.payload.days.map((day) => ({ ...day, totalTokens: day.totalTokens + 1 }));
    const { deliveryId } = JSON.parse(first);
    expect((await push('llm-usage', first)).status).toBe(200);
    expect((await push('llm-usage', withDays(bigger, { deliveryId }))).status).toBe(409);
    const older = new Date(capturedAt - 60 * 60_000).toISOString();
    expect((await push('llm-usage', withDays(bigger, { sentAt: older }))).status).toBe(409);

    expect(await rows('llm-usage')).toEqual(stored);
  });

  // Two deliveries with one id and different bodies both pass the lookup before either is
  // admitted: the second must not write its days over the first's.
  it('lets a conflicting body that lost the race write no day', async () => {
    const base = {
      producer: 'llm-usage' as const,
      source: 'llm-usage' as const,
      deliveryId: crypto.randomUUID(),
      fetchedAt: new Date(capturedAt - 60_000).toISOString(),
      receivedAt: capturedAt,
      minIntervalMs: 0,
      historySince: '2026-01-01',
    };
    const snapshot = (tokens: number) =>
      JSON.stringify({
        ...pushFixtures['llm-usage'].minimal.payload,
        days: [{ date: '2026-10-25', costUsd: null, totalTokens: tokens }],
      });

    expect(
      await admitPush(env.DB, { ...base, bodySha256: 'a', snapshotJson: snapshot(10) })
    ).toEqual({ outcome: 'accepted' });
    expect(
      await admitPush(env.DB, { ...base, bodySha256: 'b', snapshotJson: snapshot(99) })
    ).toEqual({ outcome: 'conflict' });

    expect((await rows('llm-usage')).map((row) => JSON.parse(row.json).totalTokens)).toEqual([10]);
  });

  it('never lowers a day, and replaces it at the same size or more', async () => {
    const day = (date: string, totalTokens: number, costUsd: number | null = 1) => ({
      date,
      costUsd,
      totalTokens,
    });
    await push('llm-usage', withDays([day('2026-10-24', 100), day('2026-10-25', 100)]));
    await forgetLastPush('llm-usage');
    // Logs deleted for the 24th, a repriced cost for the 25th.
    await push('llm-usage', withDays([day('2026-10-24', 0), day('2026-10-25', 100, 2)]));
    await forgetLastPush('llm-usage');
    await push('llm-usage', withDays([day('2026-10-24', 0), day('2026-10-25', 300, 2)]));

    expect(await month()).toEqual([day('2026-10-24', 100), day('2026-10-25', 300, 2)]);
  });

  it('backfills every day once, then rewrites only the newest 35', async () => {
    const day = (date: string, totalTokens: number) => ({ date, costUsd: null, totalTokens });
    await push('llm-usage', withDays([day('2026-01-10', 5), day('2026-10-25', 5)]));
    await forgetLastPush('llm-usage');
    await push(
      'llm-usage',
      withDays([
        day('2026-01-10', 9),
        day('2026-09-21', 9),
        day('2026-09-20', 9),
        day('2026-10-25', 9),
      ])
    );

    const stored = Object.fromEntries(
      (await rows('llm-usage')).map((row) => [row.day, JSON.parse(row.json).totalTokens])
    );
    // 2026-09-21 is the first of the 35 days ending 2026-10-25.
    expect(stored).toEqual({ '2026-01-10': 5, '2026-09-21': 9, '2026-10-25': 9 });
  });
});

// The rule for a day, against a plain model, over generated sequences of answers newer and
// older than what is stored, with moving `since`, failed fetches and batches that fail half
// way. Catches a delayed older answer winning, a day lowered, a day before `since` written,
// or a failure leaving part of an answer behind.
describe('history over generated sequences', () => {
  const repos = ['ayagmar/a', 'ayagmar/b', 'ayagmar/c'];
  const sinces = ['2026-10-14', '2026-10-18', '2026-10-22'];
  const recent = Array.from({ length: 10 }, (_, i) => `2026-10-${17 + i}`);
  type Stored = { json: string; size: number; token: string };

  /** A seeded generator, so a failing sequence can be replayed. */
  const random = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  function generated(next: () => number, generatedAt: string, since: string): RepoPulseActivity {
    const body = copy(okAnswer);
    body.generatedAt = generatedAt;
    body.since = since;
    for (const day of body.days) {
      day.repos = !recent.includes(day.date)
        ? []
        : repos
            .filter(() => next() < 0.5)
            .map((repo) => {
              const n = () => Math.floor(next() * 3);
              return { repo, pushes: n(), commits: n(), merges: n(), releases: n(), stars: n() };
            });
      for (const key of ['pushes', 'commits', 'merges', 'releases', 'stars'] as const) {
        day[key] = day.repos.reduce((sum, r) => sum + r[key], 0);
      }
      day.reposTruncated = false;
    }
    return body;
  }

  const size = (day: RepoPulseActivity['days'][number]) =>
    day.pushes + day.commits + day.merges + day.releases + day.stars;

  it.each([1, 2, 3])('keeps the rule for seed %i', { timeout: 60_000 }, async (seed) => {
    const next = random(seed);
    const model = new Map<string, Stored>();
    let seriesToken = '';
    let clock = Date.parse('2026-10-26T12:00:00Z');

    for (let step = 0; step < 60; step++) {
      clock += 2 * hour;
      const roll = next();
      const token = new Date(
        Date.parse('2026-10-26T00:00:00Z') + Math.floor(next() * 12) * hour
      ).toISOString();
      const since = sinces[Math.floor(next() * sinces.length)] ?? '2026-10-14';
      const body = generated(next, token, since);
      const interrupted = roll >= 0.7 && roll < 0.8;

      if (roll < 0.15) answer({ ...body, complete: false });
      else if (roll < 0.25) network.use(http.get(activityUrl, () => HttpResponse.error()));
      else if (roll < 0.3) answer({ ...body, days: body.days.slice(1) });
      else answer(body);
      if (interrupted) {
        // The batch fails at its first statement, as if the isolate were cut off mid-write.
        await env.DB.exec(
          "CREATE TRIGGER interrupt BEFORE INSERT ON snapshots WHEN NEW.json IS NOT NULL BEGIN SELECT RAISE(ABORT, 'cut'); END"
        );
      }
      await pullAt(clock);
      if (interrupted) await env.DB.exec('DROP TRIGGER interrupt');
      network.resetHandlers();

      const stored = roll >= 0.3 && !interrupted && token >= seriesToken;
      if (stored) {
        seriesToken = token;
        for (const day of body.days) {
          if (day.date < since) continue;
          const { date, ...data } = day;
          const json = JSON.stringify(data);
          const old = model.get(date);
          if (old === undefined || (old.json !== json && size(day) >= old.size)) {
            model.set(date, { json, size: size(day), token });
          }
        }
      }

      const actual = await rows();
      expect(
        actual.map((row) => [row.day, JSON.parse(row.json), row.fetched_at]),
        `seed ${seed} step ${step}`
      ).toEqual(
        [...model.entries()]
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([day, { json, token: at }]) => [day, JSON.parse(json), at])
      );
    }
    expect(model.size).toBeGreaterThan(0);
  });
});
