// "On this day" in listening (ADR 0030): the Rabat day bounds in this runtime's tzdata, every
// shared fixture through the same functions the adapter uses, and whole pulls spread over
// cron invocations through the real runner and D1, with Last.fm mocked at the network.
import { env } from 'cloudflare:workers';
import { rawFixtures, snapshotFixtures } from '@min7/contracts/fixtures';
import { rabatDate, rabatDayStart } from '@min7/contracts/rabat';
import { upstreamHandlers } from '@min7/contracts/testing';
import { setupNetwork } from '@msw/cloudflare';
import { HttpResponse, http, type RequestHandler } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PullError, type PullErrorCode } from '../src/adapters/pull/index.ts';
import {
  type HistoryAnswers,
  historyFromAnswers,
  listeningHistory,
  pastDays,
  summarizeDay,
} from '../src/adapters/pull/listening-history.ts';
import { runScheduled } from '../src/cron/run.ts';
import { D1SnapshotStore } from '../src/storage/d1.ts';
import { D1ProgressStore } from '../src/storage/progress.ts';
import type { SourceStatus } from '../src/storage/types.ts';
import { clearState, fetchApi } from './helpers.ts';

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

const lastfmKey = 'fake-lastfm-key-history';
const withKey = { ...env, LASTFM_API_KEY: lastfmKey };
const at = (iso: string) => Date.parse(iso);
const seconds = (iso: string) => at(iso) / 1000;

function thrownCode(run: () => unknown): PullErrorCode | undefined {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(PullError);
    return (error as PullError).code;
  }
  return undefined;
}

describe('a day in Rabat, from tzdata', () => {
  // `zdump -v -c 2008,2027 Africa/Casablanca`, tzdata 2026e, the lines around each change:
  //   Sun Jun  1 00:00:00 2008 UT = Sun Jun  1 01:00:00 2008 +01   (no midnight on 1 June)
  //   Sun Aug 31 23:00:00 2008 UT = Sun Aug 31 23:00:00 2008 +00   (23:00 twice on 31 August)
  //   Sun Feb 23 02:00:00 2025 UT = Sun Feb 23 02:00:00 2025 +00   (Ramadan starts)
  //   Sun Apr  6 02:00:00 2025 UT = Sun Apr  6 03:00:00 2025 +01   (Ramadan ends)
  //   Sun Sep 20 01:00:00 2026 UT = Sun Sep 20 01:00:00 2026 +00   (+00 for good)
  // Catches a day derived by adding 24 hours, a fixed offset, or a missing midnight.
  it.each([
    ['2008-06-01', '2008-06-01T00:00:00Z', '2008-06-01T23:00:00Z'],
    ['2008-08-31', '2008-08-30T23:00:00Z', '2008-09-01T00:00:00Z'],
    ['2025-02-23', '2025-02-22T23:00:00Z', '2025-02-24T00:00:00Z'],
    ['2025-04-06', '2025-04-06T00:00:00Z', '2025-04-06T23:00:00Z'],
    ['2026-09-20', '2026-09-19T23:00:00Z', '2026-09-21T00:00:00Z'],
    ['2026-10-26', '2026-10-26T00:00:00Z', '2026-10-27T00:00:00Z'],
  ])('%s runs from %s to %s', (date, start, end) => {
    const [day] = pastDays(`${Number(date.slice(0, 4)) + 1}${date.slice(4)}`, 2002);
    expect(day).toEqual({ year: Number(date.slice(0, 4)), from: seconds(start), to: seconds(end) });
    expect(rabatDate(at(start) - 1000)).not.toBe(date);
    expect(rabatDate(at(start))).toBe(date);
    expect(rabatDate(at(end) - 1000)).toBe(date);
    expect(rabatDate(at(end))).not.toBe(date);
  });

  it('has 29 February only in leap years, and ends 28 February where the 29th starts', () => {
    expect(pastDays('2028-02-29', 2023).map((d) => d.year)).toEqual([2024]);
    const [, , leap] = pastDays('2027-02-28', 2023);
    expect(leap).toMatchObject({ year: 2024, to: rabatDayStart('2024-02-29') });
    expect(pastDays('2027-03-01', 2024).map((d) => d.year)).toEqual([2026, 2025, 2024]);
  });
});

describe('a day page', () => {
  const day = {
    year: 2025,
    from: seconds('2025-10-25T23:00:00Z'),
    to: seconds('2025-10-26T23:00:00Z'),
  };
  const page = (...times: number[]) => ({
    status: 200,
    body: {
      recenttracks: {
        track: times.map((uts) => ({
          artist: { '#text': 'Kiasmos' },
          name: 'Blurred',
          date: { uts: String(uts) },
        })),
        '@attr': {
          user: 'min7_',
          page: '1',
          perPage: '200',
          totalPages: '1',
          total: String(times.length),
        },
      },
    },
  });

  // Last.fm's `from` is inclusive and `to` exclusive (checked live on 2026-10-26), so a
  // scrobble at either edge of the range decides which day it belongs to. A 29 February
  // scrobble is at or after the end of 28 February's range.
  it('counts scrobbles from the start of the day up to, not including, its end', () => {
    expect(summarizeDay(day, page(day.to - 1, day.from))?.scrobbles).toBe(2);
    expect(thrownCode(() => summarizeDay(day, page(day.to)))).toBe('upstream_malformed');
    expect(thrownCode(() => summarizeDay(day, page(day.from - 1)))).toBe('upstream_malformed');
  });

  it('fails on a scrobble out of order rather than counting it', () => {
    expect(thrownCode(() => summarizeDay(day, page(day.from, day.to - 1)))).toBe(
      'upstream_malformed'
    );
  });
});

describe('the shared fixtures', () => {
  type Expected = { snapshot: unknown } | { error: PullErrorCode };
  const history = snapshotFixtures['listening-history'];
  const expected: Record<keyof (typeof rawFixtures)['lastfm-history'], Expected> = {
    // Real: 2026-10-26, three years, ties broken by the first scrobble of the day.
    ok: { snapshot: history.ok },
    // A real account, no scrobbles on the date in any year: a successful empty history.
    empty: { snapshot: history.empty },
    // Registered this year in Rabat: no past year, so empty, not a failure.
    'new-account': { snapshot: history['new-account'] },
    'single-item': { snapshot: history['single-item'] },
    'now-playing': { snapshot: history['now-playing'] },
    'leap-day': { snapshot: history['leap-day'] },
    'feb-28': { snapshot: history['feb-28'] },
    ties: { snapshot: history.ties },
    approximate: { snapshot: history.approximate },
    // A registration Last.fm does not give is a failure, not an empty history.
    'unknown-registration': { error: 'upstream_malformed' },
    'error-in-200': { error: 'upstream_rate_limited' },
    missing: { error: 'upstream_http_error' },
    malformed: { error: 'upstream_malformed' },
    inconsistent: { error: 'upstream_malformed' },
  };

  it.each(Object.entries(rawFixtures['lastfm-history']))('reads the %s case', (name, raw) => {
    const want = expected[name as keyof typeof expected];
    const read = () => historyFromAnswers(raw as HistoryAnswers);
    if ('snapshot' in want) expect(read()).toEqual(want.snapshot);
    else expect(thrownCode(read)).toBe(want.error);
  });

  // Catches grouping by title or MBID, a tie going to page order, and names used as object keys.
  it('names one track by its exact artist and title, and breaks ties by first play, then code point', () => {
    const [year] = history.ties.years;
    // "Intro" by two artists twice each, never merged into four plays; MBIDs that change do
    // not split a track; "constructor" / "__proto__" ties on plays and first time, and loses
    // to "Artist A" by code point.
    expect(year?.top).toEqual({ artist: 'Artist A', track: 'Intro', plays: 2 });
  });

  it("marks a day read only in part, and keeps Last.fm's total for it", () => {
    expect(history.approximate.years[0]).toMatchObject({ scrobbles: 450, read: 200 });
  });
});

/** A source's row as /v1/health and the scheduler see it. */
const health = async () =>
  (
    await fetchApi('/v1/health').then((r) =>
      r.json<{ sources: { source: string; lastErrorCode: string | null }[] }>()
    )
  ).sources.find((s) => s.source === 'listening-history');

/** What /v1/listening-history serves now, past the edge cache. */
const served = async () => {
  await caches.default.delete('https://api.ayagmar.dev/v1/listening-history');
  return fetchApi('/v1/listening-history').then((r) => r.json<{ data: unknown; stale: boolean }>());
};

/** Every Last.fm request, as the form signals posted, answered by `handlers`. */
function recordRequests(...handlers: RequestHandler[]) {
  const requests: { url: string; form: Record<string, string> }[] = [];
  // Handlers added later run first: the recorder sees each request, then passes it on.
  network.use(...handlers);
  network.use(
    http.post('https://ws.audioscrobbler.com/2.0/', async ({ request }) => {
      requests.push({
        url: request.url,
        form: Object.fromEntries((await request.clone().formData()).entries()) as Record<
          string,
          string
        >,
      });
    })
  );
  return requests;
}

/** Cron invocations a minute apart from `start` until the history is published or fails. */
async function pull(start: number, limit = 10) {
  vi.useFakeTimers({ toFake: ['Date'] });
  const codes: (string | null | undefined)[] = [];
  for (let i = 0; i < limit; i++) {
    vi.setSystemTime(start + i * 60_000 + 1500);
    await runScheduled(withKey, [listeningHistory], start + i * 60_000);
    const code = (await health())?.lastErrorCode;
    codes.push(code);
    if (code !== 'in_progress') break;
  }
  return codes;
}

describe('a pull spread over cron invocations', () => {
  const captured = at('2026-10-26T16:31:55Z');

  it('reads one year per invocation and publishes only when every year is read', async () => {
    const requests = recordRequests(...upstreamHandlers());

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(captured);
    await runScheduled(withKey, [listeningHistory], captured);
    // Registration and the newest year; nothing published yet.
    expect(requests.map((r) => r.form.method)).toEqual(['user.getinfo', 'user.getrecenttracks']);
    expect(await health()).toMatchObject({ lastErrorCode: 'in_progress' });
    expect((await served()).data).toBeNull();

    // Then one year each: 2024 and 2023, the date's own ranges, page 1 of 200, each once.
    expect(await pull(captured + 60_000)).toEqual(['in_progress', null]);
    expect(requests.slice(1).map(({ form }) => [form.from, form.to])).toEqual(
      rawFixtures['lastfm-history'].ok.days.map((d) => [String(d.from), String(d.to)])
    );
    for (const { url, form } of requests) {
      expect(url).toBe('https://ws.audioscrobbler.com/2.0/');
      expect(form).toMatchObject({ user: 'min7_', format: 'json', api_key: lastfmKey });
      if (form.method === 'user.getrecenttracks')
        expect(form).toMatchObject({ limit: '200', page: '1' });
    }
    expect(await served()).toMatchObject({
      stale: false,
      data: snapshotFixtures['listening-history'].ok,
    });
    expect(await env.DB.prepare('SELECT * FROM pull_progress').all()).toMatchObject({
      results: [],
    });
  });

  it('keeps the last snapshot when a year fails, and carries on from the failed year', async () => {
    // Yesterday's history is stored; today's pull reads 2025, then Last.fm refuses 2024.
    const yesterday = { ...snapshotFixtures['listening-history'].ok, describedDate: '2026-10-25' };
    await new D1SnapshotStore(env.DB).put(
      'listening-history',
      yesterday,
      '2026-10-25T12:00:00.000Z'
    );
    const ok = rawFixtures['lastfm-history'].ok;
    let refuse = true;
    const requests = recordRequests(
      http.post('https://ws.audioscrobbler.com/2.0/', async ({ request }) => {
        const form = await request.formData();
        if (form.get('method') === 'user.getinfo') return HttpResponse.json(ok.registration.body);
        const day = ok.days.find((d) => String(d.from) === form.get('from'));
        if (day?.year === 2024 && refuse) {
          return HttpResponse.json({ error: 29, message: 'Rate Limit Exceeded' });
        }
        return HttpResponse.json(day?.page.body);
      })
    );
    expect(await pull(captured)).toEqual(['in_progress', 'upstream_rate_limited']);
    // Nothing published: yesterday's history stands, for the site to hide on today's date.
    expect(await served()).toMatchObject({ data: yesterday });

    // At the next retry the pull resumes at 2024; 2025 is not read again.
    refuse = false;
    const retried = requests.length;
    expect(await pull(captured + 61 * 60_000)).toEqual(['in_progress', null]);
    expect(requests.slice(retried).map((r) => r.form.from)).toEqual(
      ok.days.slice(1).map((d) => String(d.from))
    );
    expect((await served()).data).toEqual(snapshotFixtures['listening-history'].ok);
  });

  it('drops a pull that crosses midnight in Rabat instead of labelling it with the new date', async () => {
    network.use(...upstreamHandlers({ lastfmHistory: 'new-account' }));
    // The registration answers just after midnight, though the pull began just before it.
    network.use(
      http.post('https://ws.audioscrobbler.com/2.0/', () => {
        vi.setSystemTime(at('2026-10-27T00:00:00.500Z'));
      })
    );
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(at('2026-10-26T23:59:59.500Z'));
    await runScheduled(withKey, [listeningHistory], at('2026-10-26T23:59:00Z'));
    expect(await health()).toMatchObject({ lastErrorCode: 'date_changed' });
    expect((await served()).data).toBeNull();
  });

  // Catches a snapshot written just after midnight for the day before, which the scheduler
  // would take for the new date's.
  it('drops a pull that would finish in the last seconds before midnight', async () => {
    network.use(...upstreamHandlers({ lastfmHistory: 'new-account' }));
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(at('2026-10-26T23:59:56Z'));
    await runScheduled(withKey, [listeningHistory], at('2026-10-26T23:59:00Z'));
    expect(await health()).toMatchObject({ lastErrorCode: 'date_changed' });
  });

  // Catches a snapshot for yesterday, written after midnight because D1 was slow, taken for
  // today's: the new date's pull would then wait 7 hours.
  it("starts the new date's pull at once after yesterday's lands past midnight", async () => {
    const ok = snapshotFixtures['listening-history'].ok;
    // The last part of 26 October's pull: 2025 and 2024 are read.
    await env.DB.prepare(
      "INSERT INTO pull_progress (source, described_date, step, json) VALUES ('listening-history', '2026-10-26', 2, ?)"
    )
      .bind(JSON.stringify({ firstYear: ok.firstYear, read: 2, years: ok.years.slice(0, 2) }))
      .run();
    await new D1SnapshotStore(env.DB).recordFailure(
      'listening-history',
      'in_progress',
      '2026-10-26T23:58:54Z'
    );
    const requests = recordRequests(...upstreamHandlers());
    // D1 takes 7 seconds to clear the progress.
    const clear = D1ProgressStore.prototype.clear;
    vi.spyOn(D1ProgressStore.prototype, 'clear').mockImplementation(async function (
      this: D1ProgressStore
    ) {
      vi.setSystemTime(Date.now() + 7_000);
      return clear.call(this);
    });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(at('2026-10-26T23:59:54Z'));
    await runScheduled(withKey, [listeningHistory], at('2026-10-26T23:59:00Z'));
    expect(await served()).toMatchObject({ data: { describedDate: '2026-10-26' } });

    const before = requests.length;
    vi.setSystemTime(at('2026-10-27T00:01:01.500Z'));
    await runScheduled(withKey, [listeningHistory], at('2026-10-27T00:01:00Z'));
    expect(requests.slice(before).map((r) => r.form.method)).toContain('user.getinfo');
  });

  // Catches a slow write from before midnight replacing the new date's history.
  it("never replaces a date's history with an earlier date's", async () => {
    const store = new D1SnapshotStore(env.DB);
    const ok = snapshotFixtures['listening-history'].ok;
    await store.put(
      'listening-history',
      { ...ok, describedDate: '2026-10-27' },
      '2026-10-27T00:00:09Z'
    );
    await store.put('listening-history', ok, '2026-10-27T00:00:10Z');
    expect(await served()).toMatchObject({ data: { describedDate: '2026-10-27' } });
    await store.put(
      'listening-history',
      { ...ok, describedDate: '2026-10-28' },
      '2026-10-28T00:01:00Z'
    );
    expect(await served()).toMatchObject({ data: { describedDate: '2026-10-28' } });
  });

  it('lets only one of two overlapping invocations save the same year', async () => {
    const ok = rawFixtures['lastfm-history'].ok;
    // Answers every request, repeats included: two invocations ask the same things.
    network.use(
      http.post('https://ws.audioscrobbler.com/2.0/', async ({ request }) => {
        const form = await request.formData();
        if (form.get('method') === 'user.getinfo') return HttpResponse.json(ok.registration.body);
        return HttpResponse.json(
          ok.days.find((d) => String(d.from) === form.get('from'))?.page.body
        );
      })
    );
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(captured);
    const results = await Promise.allSettled([
      listeningHistory.fetch(withKey, AbortSignal.timeout(5000)),
      listeningHistory.fetch(withKey, AbortSignal.timeout(5000)),
    ]);
    expect(results.map((r) => r.status === 'rejected' && (r.reason as PullError).code)).toEqual([
      'in_progress',
      'in_progress',
    ]);
    const row = await env.DB.prepare('SELECT step, json FROM pull_progress').first<{
      step: number;
      json: string;
    }>();
    // One part saved: 2025 once, not twice.
    expect(row?.step).toBe(1);
    expect(JSON.parse(row?.json ?? '{}')).toMatchObject({ read: 1, years: [{ year: 2025 }] });
  });

  it('never puts the key in a URL or a log line, on the error paths too', async () => {
    const requests = recordRequests(...upstreamHandlers({ lastfmHistory: 'error-in-200' }));
    const logs = [vi.spyOn(console, 'warn'), vi.spyOn(console, 'log'), vi.spyOn(console, 'error')];
    for (const spy of logs) spy.mockImplementation(() => {});
    await pull(
      Date.parse(`${rawFixtures['lastfm-history']['error-in-200'].describedDate}T12:00:00Z`)
    );
    expect(requests.length).toBeGreaterThan(1);
    for (const { url } of requests) expect(url).not.toContain(lastfmKey);
    expect(JSON.stringify(logs.map((spy) => spy.mock.calls))).not.toContain(lastfmKey);
    expect(await health()).toMatchObject({ lastErrorCode: 'upstream_rate_limited' });
  });

  it('fails a registration Last.fm does not give, and keeps an earlier history', async () => {
    network.use(...upstreamHandlers());
    await pull(captured);
    network.resetHandlers();
    network.use(...upstreamHandlers({ lastfmHistory: 'unknown-registration' }));
    // The refresh, seven hours after the last invocation of that pull.
    await pull(captured + 7 * 3600_000 + 3 * 60_000);
    expect(await health()).toMatchObject({ lastErrorCode: 'upstream_malformed' });
    expect((await served()).data).toEqual(snapshotFixtures['listening-history'].ok);
  });
});

describe("Last.fm's Retry-After", () => {
  /** Last.fm refusing with error 29 and HTTP 429, with `headers`. */
  const refused = (headers: Record<string, string> = {}) =>
    http.post('https://ws.audioscrobbler.com/2.0/', () =>
      HttpResponse.json({ error: 29, message: 'Rate Limit Exceeded' }, { status: 429, headers })
    );

  /** The minutes from `from`, `count` triggers in all, at which the history asked Last.fm. */
  async function asked(requests: unknown[], from: string, count: number) {
    vi.useFakeTimers({ toFake: ['Date'] });
    const minutes: string[] = [];
    for (let i = 0; i < count; i++) {
      const scheduled = at(from) + i * 60_000;
      vi.setSystemTime(scheduled + 1500);
      const before = requests.length;
      await runScheduled(withKey, [listeningHistory], scheduled);
      if (requests.length > before) minutes.push(new Date(scheduled).toISOString().slice(11, 16));
    }
    return minutes;
  }

  // Catches a retry before the time Last.fm named, which keeps the shared key refused, in
  // both of Retry-After's forms.
  it.each([
    ['seconds', '3600'],
    ['an HTTP date', 'Tue, 27 Oct 2026 01:01:02 GMT'],
  ])('waits until the time it gives as %s', async (_form, value) => {
    const requests = recordRequests(refused({ 'Retry-After': value }));
    expect(await asked(requests, '2026-10-27T00:01:00Z', 62)).toEqual(['00:01', '01:02']);
    expect(await health()).toMatchObject({ lastErrorCode: 'upstream_rate_limited' });
  });

  // Catches the new date's eagerness, or a restarted isolate, running before the deadline.
  it('holds across midnight in Rabat', async () => {
    const requests = recordRequests(refused({ 'Retry-After': '1200' }));
    expect(await asked(requests, '2026-10-26T23:50:00Z', 23)).toEqual(['23:50', '00:11']);
  });

  // Catches error 29 without a usable header retried every minute, or never.
  it.each([
    ['no header', {}],
    ['a header it cannot read', { 'Retry-After': 'soon' }],
    ['a time already past', { 'Retry-After': 'Mon, 26 Oct 2026 00:00:00 GMT' }],
  ])('falls back to 5 minutes with %s', async (_case, headers) => {
    const requests = recordRequests(refused(headers));
    expect(await asked(requests, '2026-10-27T00:01:00Z', 7)).toEqual(['00:01', '00:06']);
  });
});

describe('when a pull is due', () => {
  const status = (fields: Partial<SourceStatus>): SourceStatus => ({
    source: 'listening-history',
    fetchedAt: null,
    lastSuccessAt: null,
    lastErrorCode: null,
    lastAttemptAt: null,
    describedDate: null,
    retryAfterAt: null,
    ...fields,
  });
  const due = (fields: Partial<SourceStatus>, now: string) =>
    new Date(listeningHistory.dueAt?.(status(fields), at(now)) ?? Number.NaN).toISOString();

  // Rabat at +00 (2026) and at +01 (2025): midnight is 00:00 UTC, then 23:00 UTC.
  it.each([
    ['2026-10-26T23:58:00Z', '2026-10-27T00:00:00Z', '2026-10-27T00:00:00.000Z'],
    ['2025-10-26T22:58:00Z', '2025-10-26T23:00:00Z', '2025-10-26T23:00:00.000Z'],
  ])('is overdue at the first trigger of a new date after a pull at %s', (last, now, midnight) => {
    // A success, or a failure, minutes before midnight does not hold back the new date, and
    // the history goes ahead of sources that fell due at midnight.
    const yesterday = { describedDate: last.slice(0, 10) };
    for (const fields of [yesterday, { ...yesterday, lastErrorCode: 'upstream_timeout' }]) {
      expect(at(due({ lastAttemptAt: at(last), ...fields }, now))).toBeLessThan(at(midnight));
    }
  });

  it("carries on soon while in progress, and refreshes today's history seven hours on", () => {
    expect(
      due(
        { lastAttemptAt: at('2026-10-26T00:01:00Z'), lastErrorCode: 'in_progress' },
        '2026-10-26T00:01:30Z'
      )
    ).toBe('2026-10-26T00:01:30.000Z');
    expect(
      due(
        { lastAttemptAt: at('2026-10-26T00:02:00Z'), describedDate: '2026-10-26' },
        '2026-10-26T01:00:00Z'
      )
    ).toBe('2026-10-26T07:02:00.000Z');
  });

  // Catches a failing source tried every minute, and one waiting until tomorrow.
  it('retries a new date after 5 minutes, then at half the time since midnight, at most an hour', () => {
    const failed = (last: string) =>
      due({ lastAttemptAt: at(last), lastErrorCode: 'upstream_timeout' }, last);
    expect(failed('2026-10-26T00:01:00Z')).toBe('2026-10-26T00:06:00.000Z');
    expect(failed('2026-10-26T00:30:00Z')).toBe('2026-10-26T00:45:00.000Z');
    expect(failed('2026-10-26T16:00:00Z')).toBe('2026-10-26T17:00:00.000Z');
  });
});
