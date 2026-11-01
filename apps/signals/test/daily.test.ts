// Daily history (ADR 0038): the activity pull through the cron, `/v1/days`, the llm-usage push's
// days, and the merge rule over generated sequences of pulls, failures and interruptions.
import { env } from 'cloudflare:workers';
import {
  type LlmUsageDay,
  llmUsageDaysEnvelopeSchema,
  type RepoPulseActivity,
  shippingActivityDaysEnvelopeSchema,
} from '@min7/contracts';
import { daysFixtures, pushFixtures, rawFixtures } from '@min7/contracts/fixtures';
import { rabatDayStart } from '@min7/contracts/rabat';
import { upstreamHandlers } from '@min7/contracts/testing';
import { setupNetwork } from '@msw/cloudflare';
import { HttpResponse, http } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { shippingActivity } from '../src/adapters/pull/shipping-activity.ts';
import { runScheduled } from '../src/cron/run.ts';
import { admitPush } from '../src/storage/admission.ts';
import { D1SnapshotStore } from '../src/storage/d1.ts';
import {
  clearState,
  delivery,
  deliveryRows,
  fetchApi,
  forgetLastPush,
  push,
  snapshotRow,
} from './helpers.ts';

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

/** Answers the activity route with `body` (HTTP 200), cut to the days asked for. */
const answer = (body: RepoPulseActivity) =>
  network.use(
    http.get(activityUrl, ({ request }) => {
      const asked = Number(new URL(request.url).searchParams.get('days'));
      return HttpResponse.json({ ...body, days: body.days.slice(-asked) });
    })
  );

/** Counts the requests to the activity route, still answered by the handlers in place. */
function countRequests() {
  const seen = { count: 0 };
  network.use(
    http.get(activityUrl, () => {
      seen.count += 1;
    })
  );
  return seen;
}

/** Fails every insert into `table` while `run` runs, as if the isolate were cut off there. */
async function failingInserts(table: 'daily' | 'snapshots', run: () => Promise<unknown>) {
  const when = table === 'snapshots' ? 'WHEN NEW.json IS NOT NULL' : '';
  await env.DB.exec(
    `CREATE TRIGGER cut BEFORE INSERT ON ${table} ${when} BEGIN SELECT RAISE(ABORT, 'cut'); END`
  );
  try {
    return await run();
  } finally {
    await env.DB.exec('DROP TRIGGER cut');
  }
}

const counts = ['pushes', 'commits', 'merges', 'releases', 'stars'] as const;
type ActivityDay = RepoPulseActivity['days'][number];

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

const storedSnapshot = async () => {
  const row = await snapshotRow('shipping-activity');
  return {
    fetchedAt: row?.fetched_at ?? null,
    json: row?.json == null ? null : JSON.parse(row.json),
  };
};

const days = async (series: string, query: string) => {
  const response = await fetchApi(`/v1/days/${series}?${query}`);
  return { response, body: await response.json<{ fetchedAt: string | null; data: unknown }>() };
};

type ServedDay = {
  date: string;
  pushes: number;
  commits: number;
  merges: number;
  repos: { repo: string; commits: number; merges: number }[];
  reposComplete: boolean;
};
const servedOctober = async () =>
  ((await days('shipping-activity', 'month=2026-10')).body.data as { days: ServedDay[] }).days;

/** `okAnswer` dated `generatedAt`, with `change` applied to it. */
function later(generatedAt: string, change: (body: RepoPulseActivity) => void) {
  const body = copy(okAnswer);
  body.generatedAt = generatedAt;
  change(body);
  return body;
}

/** The day of `body` dated `date`. */
function dayOf(body: RepoPulseActivity, date: string): ActivityDay {
  const day = body.days.find((d) => d.date === date);
  if (day === undefined) throw new Error(`no ${date} in the answer`);
  return day;
}

/** Adds `by` to a count of `repo` on `day`, and to the day's total. */
function add(day: ActivityDay, repo: string, key: (typeof counts)[number], by: number) {
  const entry = day.repos.find((r) => r.repo === repo);
  if (entry === undefined) throw new Error(`no ${repo} on ${day.date}`);
  entry[key] += by;
  day[key] += by;
}

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

  // The first pull of a UTC date asks for 400 days, the others for 35 (ADR 0038). Catches a
  // pull that never asks for the whole window again, or always does.
  it('asks for the whole 400 days once a UTC date, and for 35 days otherwise', async () => {
    const asked: string[] = [];
    network.use(
      http.get(activityUrl, ({ request }) => {
        asked.push(new URL(request.url).searchParams.get('days') ?? '');
      }),
      ...upstreamHandlers()
    );
    await pullAt(capturedAt);
    await pullAt(capturedAt + hour);
    await pullAt(Date.parse('2026-10-27T00:20:00Z'));

    expect(asked).toEqual(['400', '35', '400']);
  });

  it.each([
    ['missing', 'upstream_not_found'],
    ['unavailable', 'upstream_http_error'],
    ['malformed', 'upstream_malformed'],
    ['incomplete', 'upstream_incomplete'],
  ] as const)('keeps what it had when the answer is %s (%s)', async (name, code) => {
    network.use(...upstreamHandlers());
    await pullAt(capturedAt);
    const before = { rows: await rows(), snapshot: await storedSnapshot() };

    network.use(...upstreamHandlers({ repoPulseActivity: name }));
    await pullAt(capturedAt + 2 * hour);

    expect({ rows: await rows(), snapshot: await storedSnapshot() }).toEqual(before);
    expect((await health())?.lastErrorCode).toBe(code);
  });

  // repo-pulse's visibility gate answers `complete: false` when cold and stays warm 60 seconds.
  // Catches a pull that waits an hour, cold again, and so never completes.
  it('asks again at once after an incomplete answer, and stores the complete one', async () => {
    let calls = 0;
    network.use(
      http.get(activityUrl, () => {
        calls += 1;
        return calls === 1 ? HttpResponse.json({ ...okAnswer, complete: false }) : undefined;
      }),
      ...upstreamHandlers()
    );
    await pullAt(capturedAt);

    expect(calls).toBe(2);
    expect(await rows()).toHaveLength(15);
    expect((await health())?.lastErrorCode).toBeNull();
  });

  it('tries again two minutes after a second incomplete answer, not an hour', async () => {
    answer({ ...okAnswer, complete: false });
    await pullAt(capturedAt);
    expect((await health())?.lastErrorCode).toBe('upstream_incomplete');

    network.resetHandlers();
    network.use(...upstreamHandlers());
    const seen = countRequests();
    await pullAt(capturedAt + 60_000);
    expect(seen.count).toBe(0);
    await pullAt(capturedAt + 2 * 60_000);
    expect(seen.count).toBe(1);
    expect(await rows()).toHaveLength(15);
  });

  // An answer that is not a whole window would leave holes or misplaced days in history.
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
    network.use(http.get(activityUrl, () => HttpResponse.json(body)));
    await pullAt(capturedAt);

    expect(await rows()).toEqual([]);
    expect((await health())?.lastErrorCode).toBe('upstream_malformed');
  });

  // `since` is when repo-pulse began recording: an answer whose days contradict it is not
  // trusted, and the last good snapshot and history stay as they were.
  it.each([
    ['a `since` after its last day', (body: RepoPulseActivity) => (body.since = '2026-10-27')],
    ['activity before `since`', (body: RepoPulseActivity) => (body.since = '2026-10-14')],
    ['activity and no `since`', (body: RepoPulseActivity) => (body.since = null)],
  ])('refuses an answer with %s, keeping what it had', async (_case, breakIt) => {
    network.use(...upstreamHandlers());
    await pullAt(capturedAt);
    const before = { rows: await rows(), snapshot: await storedSnapshot() };

    network.resetHandlers();
    answer(later('2026-10-26T10:00:00.000Z', breakIt));
    await pullAt(capturedAt + 2 * hour);

    expect({ rows: await rows(), snapshot: await storedSnapshot() }).toEqual(before);
    expect((await health())?.lastErrorCode).toBe('upstream_malformed');
  });

  it('refuses an answer dated more than 5 minutes ahead of its clock', async () => {
    network.use(...upstreamHandlers());
    await pullAt(Date.parse('2026-10-26T08:49:00Z'));

    expect(await rows()).toEqual([]);
    expect((await health())?.lastErrorCode).toBe('upstream_malformed');
  });

  it('keeps the newer answer when an older one arrives after it', async () => {
    answer(
      later('2026-10-26T10:00:00.000Z', (body) =>
        add(dayOf(body, '2026-10-26'), 'ayagmar/ccdesk', 'pushes', 5)
      )
    );
    await pullAt(Date.parse('2026-10-26T10:01:00Z'));
    const before = { rows: await rows(), snapshot: await storedSnapshot() };

    network.resetHandlers();
    network.use(...upstreamHandlers());
    await pullAt(Date.parse('2026-10-26T11:30:00Z'));

    expect({ rows: await rows(), snapshot: await storedSnapshot() }).toEqual(before);
    expect((await health())?.lastErrorCode).toBeNull();
  });

  // Two answers dated alike: the first stored wins whole, snapshot and days together.
  it('keeps the first of two answers with the same date, days and snapshot alike', async () => {
    network.use(...upstreamHandlers());
    await pullAt(capturedAt);
    const before = { rows: await rows(), snapshot: await storedSnapshot() };

    network.resetHandlers();
    answer(
      later(okAnswer.generatedAt, (body) => {
        add(dayOf(body, '2026-10-26'), 'ayagmar/ccdesk', 'merges', 9);
        for (const day of body.days)
          day.repos = day.repos.filter((r) => r.repo !== 'ayagmar/runnerd');
        for (const date of ['2026-10-21', '2026-10-22']) {
          const day = dayOf(body, date);
          for (const key of counts) day[key] = day.repos.reduce((sum, r) => sum + r[key], 0);
        }
      })
    );
    await pullAt(capturedAt + 2 * hour);

    expect({ rows: await rows(), snapshot: await storedSnapshot() }).toEqual(before);
  });

  // A repository made private drops out of repo-pulse's answers, counts and all, while another
  // has late activity on the same day. Catches the hidden repository's counts lost, the late
  // activity refused because the day looks smaller, or the hidden name still served.
  it('keeps a hidden repository’s counts unnamed and adds late activity on the same day', async () => {
    network.use(...upstreamHandlers());
    await pullAt(capturedAt);
    const hidden = 'ayagmar/repo-pulse';
    const date = '2026-10-22';
    const before = dayOf(okAnswer, date);

    const next = later('2026-10-26T10:55:00.000Z', (body) => {
      for (const day of body.days) {
        const gone = day.repos.filter((r) => r.repo === hidden);
        day.repos = day.repos.filter((r) => r.repo !== hidden);
        for (const key of counts) day[key] -= gone.reduce((sum, r) => sum + r[key], 0);
      }
      add(dayOf(body, date), 'ayagmar/runnerd', 'merges', 5);
    });
    network.resetHandlers();
    answer(next);
    // The second pull of the UTC date asks for 35 days.
    await pullAt(Date.parse('2026-10-26T11:00:00Z'));

    const served = (await servedOctober()).find((day) => day.date === date);
    expect(served?.pushes).toBe(before.pushes);
    expect(served?.merges).toBe(before.merges + 5);
    expect(served?.repos.find((r) => r.repo === 'ayagmar/runnerd')?.merges).toBe(
      (before.repos.find((r) => r.repo === 'ayagmar/runnerd')?.merges ?? 0) + 5
    );
    expect(served?.reposComplete).toBe(false);
    expect(JSON.stringify(await servedOctober())).not.toContain(hidden);
  });

  // Catches a day judged by one total: fewer commits must not refuse more merges, and must not
  // lower the commits stored.
  it('keeps each count of each repository at the most any answer gave', async () => {
    network.use(...upstreamHandlers());
    await pullAt(capturedAt);
    const date = '2026-10-25';
    const repo = 'ayagmar/ayagmar.dev';
    const before = dayOf(okAnswer, date);
    const beforeRepo = before.repos.find((r) => r.repo === repo);

    network.resetHandlers();
    answer(
      later('2026-10-26T10:55:00.000Z', (body) => {
        add(dayOf(body, date), repo, 'commits', -3);
        add(dayOf(body, date), repo, 'merges', 1);
      })
    );
    await pullAt(Date.parse('2026-10-26T11:00:00Z'));

    const served = (await servedOctober()).find((day) => day.date === date);
    expect(served).toMatchObject({ commits: before.commits, merges: before.merges + 1 });
    expect(served?.repos.find((r) => r.repo === repo)).toMatchObject({
      commits: beforeRepo?.commits,
      merges: (beforeRepo?.merges ?? 0) + 1,
    });
    expect(served?.reposComplete).toBe(true);
  });

  // Two pulls that read what is stored before either writes: the second must not write days
  // merged with the state the first replaced, which would lose the first's counts.
  it('drops a write prepared from a state stored over meanwhile', async () => {
    const store = new D1SnapshotStore(env.DB);
    const date = '2026-10-26';
    const pull = (body: RepoPulseActivity) =>
      store.putDated(
        'shipping-activity',
        shippingActivity.history(shippingActivity.normalize({ status: 200, body })),
        new Date(capturedAt + 3 * hour).toISOString()
      );
    const first = later('2026-10-26T10:00:00.000Z', (body) =>
      add(dayOf(body, date), 'ayagmar/ccdesk', 'merges', 5)
    );
    const second = later('2026-10-26T11:00:00.000Z', (body) =>
      add(dayOf(body, date), 'ayagmar/ccdesk', 'commits', 7)
    );
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(capturedAt + 3 * hour);
    await Promise.all([pull(first), pull(second)]);

    // The first read first, so the second either wrote after it, from what it stored, or was
    // dropped; never written from the state before it.
    const day = (await servedOctober()).find((d) => d.date === date);
    const base = dayOf(okAnswer, date);
    if ((await storedSnapshot()).fetchedAt === first.generatedAt) {
      expect(day).toMatchObject({ merges: base.merges + 5, commits: base.commits });
    } else {
      expect(day).toMatchObject({ merges: base.merges + 5, commits: base.commits + 7 });
    }
  });

  // Catches a snapshot written without its days: a failure after the snapshot statement must
  // undo the whole batch, and the same answer must store whole on the next try.
  it('stores nothing when writing a day fails, and the same answer whole on the next try', async () => {
    network.use(...upstreamHandlers());
    await failingInserts('daily', () => pullAt(capturedAt));

    expect(await rows()).toEqual([]);
    expect((await storedSnapshot()).json).toBeNull();
    expect((await health())?.lastErrorCode).toBe('store_failed');

    await pullAt(capturedAt + hour);
    expect(await rows()).toHaveLength(15);
    expect((await storedSnapshot()).fetchedAt).toBe('2026-10-26T08:55:00.000Z');
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

  // A copy of the last 28 days cached just before midnight in the series' zone must not be
  // served after it: a site built then would draw yesterday's window.
  it.each([
    ['shipping-activity', 'UTC', Date.parse('2026-10-27T00:00:00Z'), '2026-10-27'],
    ['llm-usage', 'Rabat', rabatDayStart('2026-10-27') * 1000, '2026-10-27'],
  ])('moves the last 28 days of %s at midnight (%s)', async (series, _zone, midnight, today) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(capturedAt);
    if (series === 'llm-usage') await push('llm-usage', delivery(pushFixtures['llm-usage'].ok));
    else {
      network.use(...upstreamHandlers());
      await pullAt(capturedAt);
    }

    vi.setSystemTime(midnight - 10_000);
    const before = await days(series, 'last=28');
    expect((before.body.data as { to: string }).to).toBe('2026-10-26');
    expect(before.response.headers.get('cache-control')).toBe('public, max-age=10');
    // The copy is cached by now, and still served within the day.
    vi.setSystemTime(midnight - 5_000);
    expect((await days(series, 'last=28')).response.headers.get('cache-control')).toBe(
      'public, max-age=5'
    );

    vi.setSystemTime(midnight + 1_000);
    expect(((await days(series, 'last=28')).body.data as { to: string }).to).toBe(today);
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

  // Catches a delivery admitted without its days: a failure after the delivery and snapshot
  // statements must undo the batch, so the producer's retry of the same delivery is accepted.
  it('admits nothing when writing a day fails, and the same delivery on retry', async () => {
    const body = delivery(ok);
    const failed = (await failingInserts('daily', () => push('llm-usage', body))) as Response;
    expect(failed.status).toBe(500);
    expect(await deliveryRows()).toEqual([]);
    expect(await snapshotRow('llm-usage')).toBeNull();

    expect((await push('llm-usage', body)).status).toBe(202);
    expect(await month()).toEqual(ok.payload.days);
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

// The merge, against a plain model, over generated sequences: answers newer, older and as old
// as what is stored, whole and 35-day windows, moving `since`, repositories that come and go,
// failed fetches, and batches cut before the snapshot or after it. The model keeps, for each
// day and repository, the most each count has been in any answer stored, and the snapshot of
// the newest answer stored. Catches a delayed or equally dated answer winning, a count lowered,
// a day before `since` written, a hidden name kept, or a failure leaving part of an answer.
describe('history over generated sequences', () => {
  const names = ['ayagmar/a', 'ayagmar/b', 'ayagmar/c'];
  const sinces = ['2026-10-14', '2026-10-18', '2026-10-22'];
  const recent = Array.from({ length: 10 }, (_, i) => `2026-10-${17 + i}`);
  type Counts = Record<(typeof counts)[number], number>;
  type Model = {
    token: string | null;
    snapshot: { since: string | null; repos: string[]; fullOn: string | null } | null;
    /** Per day, per repository, the most of each count; and the token that last changed it. */
    days: Map<string, { repos: Map<string, Counts>; token: string }>;
  };

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
      day.repos =
        !recent.includes(day.date) || day.date < since
          ? []
          : names
              .filter(() => next() < 0.5)
              .map((repo) => {
                const n = () => Math.floor(next() * 3);
                return { repo, pushes: n(), commits: n(), merges: n(), releases: n(), stars: n() };
              });
      for (const key of counts) day[key] = day.repos.reduce((sum, r) => sum + r[key], 0);
      day.reposTruncated = false;
    }
    return body;
  }

  /** The stored JSON the model gives for a day. */
  function dayJson(repos: Map<string, Counts>) {
    const listed = [...repos.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([repo, c]) => ({ repo, ...c }));
    const total = Object.fromEntries(
      counts.map((key) => [key, listed.reduce((sum, r) => sum + r[key], 0)])
    );
    return { ...total, repos: listed, reposTruncated: false };
  }

  /** What storing `days` of `body` would make of `model`. */
  function stored(model: Model, body: RepoPulseActivity, days: ActivityDay[]): Model {
    const since = body.since ?? '9999-12-31';
    const recorded = days.filter((day) => day.date >= since);
    const named = new Set(recorded.flatMap((day) => day.repos.map((r) => r.repo)));
    const after: Model['days'] = new Map();
    const gone = new Set<string>();
    for (const [date, day] of model.days)
      after.set(date, { repos: new Map(day.repos), token: day.token });
    for (const day of recorded) {
      const old = after.get(day.date);
      for (const repo of old?.repos.keys() ?? []) if (!named.has(repo)) gone.add(repo);
      const repos = new Map(old?.repos ?? []);
      for (const { repo, ...c } of day.repos) {
        const was = repos.get(repo);
        repos.set(
          repo,
          was === undefined
            ? c
            : (Object.fromEntries(counts.map((k) => [k, Math.max(was[k], c[k])])) as Counts)
        );
      }
      const changed =
        old === undefined || JSON.stringify(dayJson(repos)) !== JSON.stringify(dayJson(old.repos));
      after.set(day.date, { repos, token: changed ? body.generatedAt : (old?.token ?? '') });
    }
    const whole = days.length === 400;
    const kept = whole ? [] : (model.snapshot?.repos ?? []).filter((repo) => !gone.has(repo));
    return {
      token: body.generatedAt,
      snapshot: {
        since: body.since,
        repos: [...new Set([...kept, ...named])].sort(),
        fullOn: whole ? '2026-10-26' : (model.snapshot?.fullOn ?? null),
      },
      days: after,
    };
  }

  const changesRows = (a: Model, b: Model) =>
    [...b.days].some(([date, day]) => a.days.get(date)?.token !== day.token);

  it.each([1, 2, 3])('keeps the model for seed %i', { timeout: 60_000 }, async (seed) => {
    const next = random(seed);
    let model: Model = { token: null, snapshot: null, days: new Map() };
    let clock = Date.parse('2026-10-26T12:00:00Z');

    for (let step = 0; step < 60; step++) {
      clock += 2 * hour;
      const roll = next();
      const token = new Date(
        Date.parse('2026-10-26T00:00:00Z') + Math.floor(next() * 12) * hour
      ).toISOString();
      const since = sinces[Math.floor(next() * sinces.length)] ?? '2026-10-14';
      const body = generated(next, token, since);
      const asked =
        model.snapshot?.fullOn === new Date(clock).toISOString().slice(0, 10) ? 35 : 400;
      const cut =
        roll >= 0.7 && roll < 0.75 ? 'snapshots' : roll >= 0.75 && roll < 0.8 ? 'daily' : null;

      if (roll < 0.15) answer({ ...body, complete: false });
      else if (roll < 0.25) network.use(http.get(activityUrl, () => HttpResponse.error()));
      else if (roll < 0.3) {
        const short = { ...body, days: body.days.slice(1) };
        network.use(http.get(activityUrl, () => HttpResponse.json(short)));
      } else answer(body);
      if (cut === null) await pullAt(clock);
      else await failingInserts(cut, () => pullAt(clock));
      network.resetHandlers();

      if (roll >= 0.3 && (model.token === null || token > model.token)) {
        const after = stored(model, body, body.days.slice(-asked));
        const failed = cut === 'snapshots' || (cut === 'daily' && changesRows(model, after));
        if (!failed) model = after;
      }

      const label = `seed ${seed} step ${step}`;
      expect(
        (await rows()).map((row) => [row.day, JSON.parse(row.json), row.fetched_at]),
        label
      ).toEqual(
        [...model.days.entries()]
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([day, { repos, token: at }]) => [day, dayJson(repos), at])
      );
      expect(await storedSnapshot(), label).toEqual({
        fetchedAt: model.token ?? null,
        json: model.snapshot,
      });
    }
    expect(model.days.size).toBeGreaterThan(0);
  });
});
