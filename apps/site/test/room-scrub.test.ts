import { daysFixtures, historyFixtures } from '@min7/contracts/fixtures';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dateBack, dayFacts, type Lookup, readBlock, type Series } from '../src/lib/room-day.ts';
import { scrubber } from '../src/lib/room-scrub.ts';
import type { PastDay } from '../src/lib/room-state.ts';

// The scrub's rules (ADR 0044) over generated sequences: the network is the only thing mocked,
// each answer held until the test lets it go, in any order.
const now = Date.parse('2026-11-06T12:00:00Z');

const body = (series: Series, month: string) => ({
  source: series,
  version: 1,
  fetchedAt: '2026-10-26T09:00:00Z',
  stale: false,
  data: {
    days: [...historyFixtures[series].ok.days, ...daysFixtures[series].ok.days].filter(({ date }) =>
      date.startsWith(month)
    ),
  },
});

const whole = ((series: Series, month: string) =>
  readBlock(series, month, body(series, month), now)) as Lookup;

/** A small seeded generator, so a failing sequence can be read back. */
function random(seed: number) {
  let state = seed;
  return (below: number) => {
    state = (state * 1_664_525 + 1_013_904_223) % 2 ** 32;
    return Math.floor((state / 2 ** 32) * below);
  };
}

function harness() {
  const open: { series: Series; month: string; answer(body: unknown): void }[] = [];
  const asked: string[] = [];
  const shown: { date: string | null; facts: PastDay | null }[] = [];
  const said: string[] = [];
  const scrub = scrubber({
    ask: (series, month) => {
      asked.push(`${series} ${month}`);
      return new Promise((answer) => open.push({ series, month, answer }));
    },
    now: Date.now,
    show: (date, facts) => shown.push({ date, facts }),
    say: (date) => said.push(date),
  });
  return { scrub, open, asked, shown, said };
}

beforeEach(() => {
  vi.useFakeTimers({ now });
});
afterEach(() => {
  vi.useRealTimers();
});

const settle = () => vi.advanceTimersByTimeAsync(1_100);

describe('a drag', () => {
  // Catches a request per step: a drag across three months asks only where it rests.
  it('asks only for the months of the date it rests on', async () => {
    const { scrub, asked } = harness();
    for (let back = 1; back <= 90; back++) {
      scrub.go(dateBack('2026-11-06', back));
      await vi.advanceTimersByTimeAsync(16);
    }
    expect(asked).toEqual([]);
    await settle();
    expect(asked.filter((key) => key.startsWith('listening'))).toEqual(['listening 2026-08']);
    expect(new Set(asked).size).toBe(asked.length);
  });

  // Catches an announcement per day: one settled date says one thing.
  it('announces once, after it settles and its months are answered', async () => {
    const { scrub, open, said } = harness();
    scrub.go('2026-10-16');
    scrub.go('2026-10-15');
    scrub.go('2026-10-14');
    await settle();
    expect(said).toEqual([]);
    for (const { series, month, answer } of open.splice(0)) answer(body(series, month));
    await settle();
    expect(said).toEqual(['2026-10-14']);
  });
});

describe('any sequence of dates, answers and failures', () => {
  // Catches a late answer drawn over the date the reader moved to, a failure that blanks another
  // source, a date with no records read as a failure, and anything shown after a return to now:
  // whatever the order, the last thing shown is the held date with what has been answered.
  it.each(Array.from({ length: 40 }, (_, seed) => seed + 1))('holds for seed %i', async (seed) => {
    const next = random(seed);
    const { scrub, open, shown } = harness();
    const answered = new Map<string, unknown>();
    const failed = new Set<string>();
    let held: string | null = null;

    for (let step = 0; step < 120; step++) {
      const move = next(5);
      if (move === 0) {
        held = dateBack('2026-11-06', 1 + next(420));
        scrub.go(held);
      } else if (move === 1) {
        held = null;
        scrub.go(null);
      } else if (move === 2 && open.length > 0) {
        const [{ series, month, answer }] = open.splice(next(open.length), 1) as [(typeof open)[0]];
        const key = `${series} ${month}`;
        if (next(4) === 0) {
          failed.add(key);
          answer(undefined);
        } else {
          failed.delete(key);
          answered.set(key, true);
          answer(body(series, month));
        }
      } else {
        await vi.advanceTimersByTimeAsync(next(400));
      }
      await vi.advanceTimersByTimeAsync(0);

      const last = shown.at(-1);
      expect(last?.date ?? null).toBe(held);
      if (held === null) {
        expect(last?.facts ?? null).toBe(null);
        continue;
      }
      const lookup = ((series: Series, month: string) => {
        const key = `${series} ${month}`;
        if (answered.has(key)) return whole(series, month);
        return failed.has(key) ? 'failed' : 'waiting';
      }) as Lookup;
      expect(last?.facts).toEqual(dayFacts(held, lookup));
      expect(last?.facts?.record.state).not.toBe('playing');
    }
  });
});

describe('after a return to now', () => {
  // Catches a slow answer repainting a past day once the room is live again.
  it('ignores what arrives late', async () => {
    const { scrub, open, shown } = harness();
    scrub.go('2026-10-16');
    await settle();
    scrub.go(null);
    const count = shown.length;
    for (const { series, month, answer } of open.splice(0)) answer(body(series, month));
    await settle();
    expect(shown.length).toBe(count);
    expect(shown.at(-1)).toEqual({ date: null, facts: null });
  });

  // Catches a second trip paying for what the first read: blocks stay held while the page lives.
  it('keeps what it read', async () => {
    const { scrub, open, asked } = harness();
    scrub.go('2026-10-16');
    await settle();
    for (const { series, month, answer } of open.splice(0)) answer(body(series, month));
    await settle();
    const count = asked.length;
    scrub.go(null);
    scrub.go('2026-10-17');
    await settle();
    expect(asked.length).toBe(count);
  });
});

describe('a failed month', () => {
  // Catches a source that is down being asked at every date, and one that recovers staying
  // unknown until a reload.
  it('is left alone for a minute, then asked again', async () => {
    const { scrub, open, asked } = harness();
    const listening = () => asked.filter((key) => key === 'listening 2026-10').length;
    scrub.go('2026-10-16');
    await settle();
    for (const { answer } of open.splice(0)) answer(undefined);
    await settle();
    scrub.go('2026-10-17');
    await settle();
    expect(listening()).toBe(1);
    await vi.advanceTimersByTimeAsync(60_000);
    scrub.go('2026-10-18');
    await settle();
    expect(listening()).toBe(2);
  });
});

describe('a restart', () => {
  // Catches state outliving the page: a new scrubber holds nothing and has shown nothing.
  it('starts from nothing', async () => {
    const first = harness();
    first.scrub.go('2026-10-16');
    await settle();
    const second = harness();
    expect(second.shown).toEqual([]);
    second.scrub.go('2026-10-16');
    expect(second.shown.at(-1)?.facts?.record.words).toBe(null);
  });
});
