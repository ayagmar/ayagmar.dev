// Which Last.fm reads a listening pull makes and what it carries from the stored snapshot
// (ADR 0009), through the cron runner, D1 and a mocked Last.fm.
import { env } from 'cloudflare:workers';
import { type ListeningSnapshot, listeningSnapshotSchema } from '@min7/contracts';
import { rawFixtures, snapshotFixtures } from '@min7/contracts/fixtures';
import { setupNetwork } from '@msw/cloudflare';
import { HttpResponse, http } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { listening, weekStart } from '../src/adapters/pull/listening.ts';
import { runScheduled } from '../src/cron/run.ts';
import { D1SnapshotStore } from '../src/storage/d1.ts';
import { dayReadsHeldUntil, holdDayReads } from '../src/storage/daily.ts';
import { clearState, sourceHealth } from './helpers.ts';

const network = setupNetwork();
network.configure({ onUnhandledFrame: 'error' });
beforeAll(() => network.enable());
afterEach(() => {
  network.resetHandlers();
  vi.useRealTimers();
});
afterAll(() => network.disable());
beforeEach(clearState);

const withKey = { ...env, LASTFM_API_KEY: 'fake-lastfm-key' };
const minute = 60_000;
const at = (time: string) => Date.parse(time);
/** A Monday 00:00 UTC, and 00:00 in Rabat too since Morocco moved to +00 (ADR 0030). */
const monday = at('2026-11-09T00:00:00Z');

type Part = 'recent' | 'top' | 'thisWeek' | 'lastWeek' | 'day';
type Answer = 'ok' | 'down' | 'error-in-200' | 'html' | 'new-shape' | { retryAfter: string };

/** Counts that say which week was asked for, so a carried one can be told from a fresh one. */
const countOf = (from: number) => Math.floor(from / 1000) % 100_000;

const partOf = (form: FormData): Part => {
  if (form.get('method') === 'user.gettopartists') return 'top';
  if (!form.has('from')) return 'recent';
  if (!form.has('to')) return 'thisWeek';
  return Number(form.get('to')) - Number(form.get('from')) > 25 * 3600 ? 'lastWeek' : 'day';
};

/** A Last.fm that records each read and answers as `answer` says for that part. */
function lastfm(answer: (part: Part) => Answer = () => 'ok') {
  const reads: Part[] = [];
  const ok = rawFixtures.lastfm.ok;
  network.use(
    http.post('https://ws.audioscrobbler.com/2.0/', async ({ request }) => {
      const form = await request.formData();
      const part = partOf(form);
      reads.push(part);
      const how = answer(part);
      if (how === 'down') return HttpResponse.error();
      if (how === 'error-in-200') return HttpResponse.json({ error: 11, message: 'offline' });
      if (how === 'html') return HttpResponse.html('<html>maintenance</html>');
      if (how === 'new-shape') return HttpResponse.json({ results: [] });
      if (typeof how === 'object') {
        return HttpResponse.json(
          { error: 29, message: 'slow down' },
          { status: 429, headers: { 'retry-after': how.retryAfter } }
        );
      }
      if (part === 'top') return HttpResponse.json(ok.topArtists.body);
      if (part === 'recent') return HttpResponse.json(ok.recentTracks.body);
      const total = String(countOf(Number(form.get('from')) * 1000));
      const attr = { user: 'min7_', page: '1', perPage: '1', totalPages: total, total };
      return HttpResponse.json({ recenttracks: { track: [], '@attr': attr } });
    })
  );
  return reads;
}

/** One cron run at `time`, the clock moved there first. */
async function runAt(time: number) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(time);
  await runScheduled(withKey, [listening], time);
}

const store = () => new D1SnapshotStore(env.DB);

const stored = async () =>
  listeningSnapshotSchema.parse((await store().get('listening'))?.snapshot);

const carrying = (thisWeek: number | null, lastWeek: number | null): ListeningSnapshot => ({
  ...snapshotFixtures.listening.ok,
  scrobbles: { thisWeek, lastWeek },
});

/** A snapshot as a pull stored it at `time`. */
const storeAt = (snapshot: unknown, time: number) =>
  store().put('listening', snapshot, new Date(time).toISOString());

// Past the first five minutes of the hour and inside one slot of each cadence.
const quiet = at('2026-11-04T09:40:00Z');

describe('a listening pull', () => {
  // Catches a pull that goes back to asking Last.fm four times a minute.
  it('reads only the recent tracks while the stored parts are current', async () => {
    await storeAt(carrying(41, 90), quiet - minute);
    const reads = lastfm();

    await runAt(quiet);

    expect(reads).toEqual(['recent']);
    expect(await stored()).toMatchObject({
      recent: expect.any(Array),
      topArtists: snapshotFixtures.listening.ok.topArtists,
      scrobbles: { thisWeek: 41, lastWeek: 90 },
    });
  });

  // Catches a first run that serves a blank panel until the next slot.
  it('reads every part on a first run', async () => {
    const reads = lastfm();

    await runAt(quiet);

    expect(reads.toSorted()).toEqual(['lastWeek', 'recent', 'thisWeek', 'top']);
    const monday = weekStart(new Date(quiet)) * 1000;
    expect((await stored()).scrobbles).toEqual({
      thisWeek: countOf(monday),
      lastWeek: countOf(monday - 7 * 24 * 60 * minute),
    });
  });

  // Catches a row of another shape failing every pull, or its values being trusted.
  it.each([
    ['empty', '{}'],
    ['of another shape', '{"scrobbles":{"thisWeek":"many"}}'],
  ])('reads every part over a stored snapshot that is %s', async (_, json) => {
    await storeAt(carrying(41, 90), quiet - minute);
    await env.DB.prepare("UPDATE snapshots SET json = ? WHERE source = 'listening'")
      .bind(json)
      .run();
    const reads = lastfm();

    await runAt(quiet);

    expect(reads).toHaveLength(4);
    expect(await sourceHealth('listening')).toMatchObject({ lastErrorCode: null });
    expect((await stored()).scrobbles.thisWeek).toBe(countOf(weekStart(new Date(quiet)) * 1000));
  });

  // Catches a cadence that drifts: reads per day are what the ADR states.
  it('reads this week 4 times an hour and top artists once, none in the day-read window', async () => {
    await storeAt(carrying(41, 90), at('2026-11-04T08:59:00Z'));
    const reads = lastfm();
    const slowAt: number[] = [];

    for (let i = 0; i < 60; i++) {
      const time = at('2026-11-04T09:00:00Z') + i * minute;
      const before = reads.length;
      await runAt(time);
      if (reads.slice(before).some((part) => part === 'thisWeek' || part === 'top')) {
        slowAt.push(i);
      }
    }

    expect(slowAt).toEqual([7, 22, 30, 37, 52]);
    expect(reads.filter((part) => part === 'thisWeek')).toHaveLength(4);
    expect(reads.filter((part) => part === 'top')).toHaveLength(1);
    expect(reads.filter((part) => part === 'lastWeek')).toEqual([]);
    expect(reads.filter((part) => part === 'day')).toHaveLength(10);
  });

  // Catches a slow read's failure zeroing or clearing what the page shows, or carrying with
  // nothing in the logs, the only place it shows while `stale` stays false.
  it.each<[string, Answer]>([
    ['is down', 'down'],
    ['answers an error in a 200', 'error-in-200'],
    ['answers a 200 of HTML', 'html'],
    ['answers a 200 of another shape', 'new-shape'],
  ])('keeps the stored parts while Last.fm %s for them and recent works', async (_, how) => {
    const due = at('2026-11-04T09:30:30Z');
    await storeAt(carrying(41, 90), due - 9 * minute);
    const reads = lastfm((part) => (part === 'recent' ? 'ok' : how));
    const warn = vi.spyOn(console, 'warn');

    await runAt(due);

    expect(warn.mock.calls.flat().map(String)).toContain(
      JSON.stringify({
        message: 'listening part unread',
        source: 'listening',
        parts: 'topArtists,thisWeek',
      })
    );
    warn.mockRestore();
    expect(reads.toSorted()).toEqual(['recent', 'thisWeek', 'top'].toSorted());
    expect(await stored()).toMatchObject({
      topArtists: snapshotFixtures.listening.ok.topArtists,
      scrobbles: { thisWeek: 41, lastWeek: 90 },
    });
    expect(await sourceHealth('listening')).toMatchObject({ lastErrorCode: null });
  });

  // Catches a failed slow read being retried every minute instead of next slot.
  it('waits for the next slot after a failed read of a part it can carry', async () => {
    const due = at('2026-11-04T09:22:30Z');
    await storeAt(carrying(41, 90), due - minute);
    const reads = lastfm((part) => (part === 'thisWeek' ? 'down' : 'ok'));

    await runAt(due);
    await runAt(due + minute);

    expect(reads).toEqual(['recent', 'thisWeek', 'recent']);
  });

  // Catches a null that stays null for a whole slot after Last.fm recovers.
  it('asks again at the next pull for a part with nothing to carry', async () => {
    await storeAt(carrying(null, 90), quiet - minute);
    const reads = lastfm();

    await runAt(quiet);

    expect(reads.toSorted()).toEqual(['recent', 'thisWeek']);
    expect((await stored()).scrobbles.thisWeek).toBe(countOf(weekStart(new Date(quiet)) * 1000));
  });

  // Catches a slot lost to a failed pull: nothing was stored, so the read is still owed.
  it('reads a due part at the next pull when the whole pull failed', async () => {
    const due = at('2026-11-04T09:22:30Z');
    await storeAt(carrying(41, 90), due - minute);
    let recent: Answer = 'down';
    const reads = lastfm((part) => (part === 'recent' ? recent : 'ok'));

    await runAt(due);
    expect(await sourceHealth('listening')).toMatchObject({
      lastErrorCode: 'upstream_unreachable',
    });
    recent = 'ok';
    await runAt(due + minute);

    expect((await stored()).scrobbles.thisWeek).toBe(countOf(weekStart(new Date(due)) * 1000));
    expect(reads.filter((part) => part === 'thisWeek')).toHaveLength(2);
  });
});

describe('the week rollover', () => {
  // Catches last week's numbers shown as this week's on Monday.
  it('reads both weeks at the first pull of Monday', async () => {
    await storeAt(carrying(41, 90), monday - minute);
    const reads = lastfm();

    await runAt(monday + 30_000);

    expect(reads.filter((part) => part === 'thisWeek' || part === 'lastWeek').toSorted()).toEqual([
      'lastWeek',
      'thisWeek',
    ]);
    expect((await stored()).scrobbles).toEqual({
      thisWeek: countOf(monday),
      lastWeek: countOf(monday - 7 * 24 * 60 * minute),
    });
  });

  // Catches a carried count surviving because its read failed at the boundary.
  it('stores null, not the old week, when the reads fail, and fills it at the next pull', async () => {
    await storeAt(carrying(41, 90), monday - minute);
    let weeks: Answer = 'down';
    lastfm((part) => (part === 'thisWeek' || part === 'lastWeek' ? weeks : 'ok'));

    await runAt(monday + 30_000);
    expect((await stored()).scrobbles).toEqual({ thisWeek: null, lastWeek: null });

    weeks = 'ok';
    await runAt(monday + 90_000);
    expect((await stored()).scrobbles.thisWeek).toBe(countOf(monday));
  });

  // Catches the crossing pull: it began on Sunday and stored its old count seconds into Monday,
  // so its `fetchedAt` alone says this week.
  it('does not trust a snapshot stored just after the boundary', async () => {
    await storeAt(carrying(41, 90), monday + 4_000);
    const reads = lastfm();

    await runAt(monday + minute);

    expect(reads).toContain('thisWeek');
    expect(reads).toContain('lastWeek');
    expect((await stored()).scrobbles.thisWeek).toBe(countOf(monday));
  });

  // Catches a low first read standing all week: late scrobbles, or a one-off 0 from Last.fm.
  it('reads last week again once at midday on Monday', async () => {
    const repair = monday + (12 * 60 + 15) * minute;
    await storeAt(carrying(41, 0), repair - minute);
    const reads = lastfm();

    await runAt(repair - 30_000);
    expect(reads).toEqual(['recent']);
    await runAt(repair + 30_000);
    await runAt(repair + 90_000);

    expect(reads.toSorted()).toEqual(['lastWeek', 'recent', 'recent', 'recent']);
    expect((await stored()).scrobbles.lastWeek).toBe(countOf(monday - 7 * 24 * 60 * minute));
  });

  // Catches the repair read being the wrong answer: a finished week does not shrink.
  it('keeps the higher count when the repair reads less', async () => {
    const repair = monday + (12 * 60 + 15) * minute;
    await storeAt(carrying(41, 999_999), repair - minute);
    lastfm();

    await runAt(repair + 30_000);

    expect((await stored()).scrobbles.lastWeek).toBe(999_999);
  });

  // Catches a rollover missed while Last.fm's Retry-After kept the source waiting.
  it('rolls over at the first pull after a cooldown that spans the boundary', async () => {
    await storeAt(carrying(41, 90), monday - 10 * minute);
    await store().recordFailure(
      'listening',
      'upstream_rate_limited',
      new Date(monday - 9 * minute).toISOString(),
      monday + 5 * minute
    );
    const reads = lastfm();

    await runAt(monday + 4 * minute);
    expect(reads).toEqual([]);
    await runAt(monday + 6 * minute);

    expect((await stored()).scrobbles.thisWeek).toBe(countOf(monday));
  });

  // Invariant over generated runs: skipped minutes, parts and whole pulls failing, a stored row
  // of another shape, across the boundary. No module state exists to lose, so a restart is any
  // point between runs: each run starts from D1.
  it.each([1, 2, 3])('never shows a count from another week (seed %i)', async (seed) => {
    let state = seed;
    const roll = () => {
      state = (state * 48271) % 2147483647;
      return state / 2147483647;
    };
    await storeAt(carrying(41, 90), monday - 20 * minute);
    const oldWeek = monday - 7 * 24 * 60 * minute;
    lastfm((part) => {
      if (part === 'recent') return roll() < 0.1 ? 'down' : 'ok';
      return roll() < 0.4 ? 'down' : roll() < 0.1 ? 'error-in-200' : 'ok';
    });

    for (let time = monday - 15 * minute; time < monday + 45 * minute; time += minute) {
      if (roll() < 0.1) continue;
      if (roll() < 0.05) {
        await env.DB.prepare("UPDATE snapshots SET json = '{}' WHERE source = 'listening'").run();
      }
      await runAt(time + 500);
      const row = await store().get('listening');
      const parsed = listeningSnapshotSchema.safeParse(row?.snapshot);
      if (!parsed.success || Date.parse(row?.fetchedAt ?? '') < monday + 60_000) continue;
      const { thisWeek, lastWeek } = parsed.data.scrobbles;
      expect([null, countOf(monday)]).toContain(thisWeek);
      expect([null, countOf(oldWeek)]).toContain(lastWeek);
    }
  });
});

describe('a Last.fm refusal', () => {
  // Catches slow reads asking through a refusal the recording is honouring.
  it('holds the slow parts while the day reads are held, and stores the snapshot', async () => {
    const due = at('2026-11-04T09:30:30Z');
    await storeAt(carrying(41, 90), due - minute);
    await holdDayReads(env.DB, 'listening', '2026-11-04', due + 10 * minute);
    const reads = lastfm();

    await runAt(due);

    expect(reads).toEqual(['recent']);
    expect((await stored()).scrobbles).toEqual({ thisWeek: 41, lastWeek: 90 });
    expect((await store().get('listening'))?.fetchedAt).toBe(new Date(due).toISOString());
  });

  // Catches a Retry-After dropped because the recent tracks succeeded and cleared the cooldown.
  it("keeps a slow read's Retry-After, for the day reads and the backfill too", async () => {
    const due = at('2026-11-04T09:30:30Z');
    await storeAt(carrying(41, 90), due - minute);
    lastfm((part) => (part === 'top' ? { retryAfter: '600' } : 'ok'));

    await runAt(due);

    expect(await dayReadsHeldUntil(env.DB, 'listening')).toBe(due + 10 * minute);
    expect((await stored()).topArtists).toEqual(snapshotFixtures.listening.ok.topArtists);
  });

  // Catches a held rollover carrying the old week because it could not ask.
  it('leaves the weeks null across a boundary it may not ask over', async () => {
    await storeAt(carrying(41, 90), monday - minute);
    await holdDayReads(env.DB, 'listening', '2026-11-08', monday + 30 * minute);
    const reads = lastfm();

    await runAt(monday + 30_000);

    expect(reads).toEqual(['recent']);
    expect((await stored()).scrobbles).toEqual({ thisWeek: null, lastWeek: null });
  });
});
