// The history pull's progress (ADR 0030) under generated interleavings of invocations around
// midnight in Rabat, against real D1 and a new store for every call, as a restarted isolate
// would make. Each sequence is checked against a model of the rules, written apart from the
// SQL, and against the rules themselves after every event. A failure prints its seed and trace.
import { env } from 'cloudflare:workers';
import { beforeEach, expect, it } from 'vitest';
import { D1ProgressStore, type Progress } from '../src/storage/progress.ts';
import { clearState } from './helpers.ts';

beforeEach(clearState);

const dates = ['2026-10-26', '2026-10-27', '2026-10-28'] as const;
/** Another source's row, which no event may change. */
const other = { source: 'retired-source', described_date: '2026-10-27', step: 4, json: '{}' };

interface Row {
  describedDate: string;
  step: number;
  /** As `load` returns it: undefined for JSON that does not parse. */
  state: unknown;
}

/** What the store keeps from a sequence's start: empty, mid-pull, finished or unreadable. */
const starts: { name: string; row: (Row & { json: string }) | null }[] = [
  { name: 'empty', row: null },
  {
    name: 'in progress',
    row: { describedDate: dates[0], step: 2, state: { read: 2 }, json: '{"read":2}' },
  },
  { name: 'finished', row: { describedDate: dates[1], step: 5, state: null, json: 'null' } },
  {
    name: 'a shape it rejects',
    row: { describedDate: dates[1], step: 3, state: { read: 99 }, json: '{"read":99}' },
  },
  {
    name: 'JSON that does not parse',
    row: { describedDate: dates[0], step: 7, state: undefined, json: '{"read":' },
  },
];

/** mulberry32: small, seeded, the same sequence everywhere. */
function random(seed: number) {
  let a = seed;
  return (n: number) => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n);
  };
}

interface Invocation {
  id: number;
  describedDate: string;
  /** Not yet loaded, or what its load returned. */
  loaded?: Progress | null;
}

/** A new store for every call, as each invocation makes its own. */
const store = () => new D1ProgressStore(env.DB, 'listening-history');

/** Every write to `pull_progress` fails in D1 itself, while `on`. */
const setFailing = (on: boolean) =>
  env.DB.batch(
    ['INSERT', 'UPDATE'].map((kind) =>
      env.DB.prepare(
        on
          ? `CREATE TRIGGER fail_${kind} BEFORE ${kind} ON pull_progress BEGIN SELECT RAISE(ABORT, 'injected'); END`
          : `DROP TRIGGER IF EXISTS fail_${kind}`
      )
    )
  );

async function run(seed: number) {
  const pick = random(seed);
  const start = starts[pick(starts.length)] as (typeof starts)[number];
  await env.DB.prepare(
    'INSERT INTO pull_progress (source, described_date, step, json) VALUES (?, ?, ?, ?)'
  )
    .bind(other.source, other.described_date, other.step, other.json)
    .run();
  if (start.row !== null) {
    await env.DB.prepare(
      "INSERT INTO pull_progress (source, described_date, step, json) VALUES ('listening-history', ?, ?, ?)"
    )
      .bind(start.row.describedDate, start.row.step, start.row.json)
      .run();
  }
  // The model: the row as the rules say it must be, and the last step it had.
  let model: Row | null = start.row && {
    describedDate: start.row.describedDate,
    step: start.row.step,
    state: start.row.state,
  };
  let lastStep = model?.step ?? 0;
  const trace = [`seed ${seed}, starting ${start.name}`];
  const check = async () => {
    const where = trace.join('\n');
    expect(await store().load(), where).toEqual(model);
    expect(
      await env.DB.prepare('SELECT * FROM pull_progress WHERE source = ?')
        .bind(other.source)
        .first(),
      where
    ).toEqual(other);
  };

  const live: Invocation[] = [];
  let next = 0;
  for (let event = 0; event < 24; event++) {
    const invocation = live[pick(live.length + 1)];
    if (invocation === undefined) {
      // A new invocation, usually for the latest date in play, sometimes one already past.
      const latest = Math.max(
        0,
        dates.findIndex((date) => date === model?.describedDate)
      );
      const describedDate = dates[Math.min(dates.length - 1, Math.max(0, latest + pick(4) - 1))];
      live.push({ id: next++, describedDate: describedDate ?? dates[0] });
      trace.push(`#${next - 1} starts for ${describedDate}`);
      continue;
    }
    if (invocation.loaded === undefined) {
      invocation.loaded = await store().load();
      trace.push(`#${invocation.id} loads ${JSON.stringify(invocation.loaded)}`);
      expect(invocation.loaded, trace.join('\n')).toEqual(model);
      continue;
    }
    // Its one write, then it is done; or it is killed before writing.
    live.splice(live.indexOf(invocation), 1);
    const action = (['save', 'finish', 'fail', 'kill'] as const)[pick(4)];
    if (action === 'kill') {
      trace.push(`#${invocation.id} is killed`);
      await check();
      continue;
    }
    const { loaded, describedDate } = invocation;
    const state = action === 'finish' ? null : { by: invocation.id };
    const write = () =>
      action === 'finish'
        ? store().finish(loaded, describedDate)
        : store().save(loaded, describedDate, state);
    // The rules: it wins only if nothing was written since its load, and the date does not go
    // back. A win moves to a step never used before, whatever the store picks.
    const unchanged =
      loaded === null ? model === null : model !== null && model.step === loaded.step;
    const wins = unchanged && (model === null || describedDate >= model.describedDate);
    if (action === 'fail') {
      // A write that would win throws and changes nothing; one that would lose may not reach
      // the trigger at all.
      await setFailing(true);
      const outcome = await write().catch((error: Error) => error.message);
      await setFailing(false);
      trace.push(`#${invocation.id} save: ${describedDate}, D1 failing, ${outcome}`);
      expect(String(outcome), trace.join('\n')).toMatch(wins ? /injected/ : /injected|false/);
      await check();
      continue;
    }
    const won = await write();
    trace.push(`#${invocation.id} ${action}: ${describedDate}, ${won ? 'won' : 'lost'}`);
    expect(won, trace.join('\n')).toBe(wins);
    if (wins) {
      const step = (await store().load())?.step ?? 0;
      expect(step, trace.join('\n')).toBeGreaterThan(lastStep);
      lastStep = step;
      model = { describedDate, step, state };
    }
    await check();
  }
}

it.each(Array.from({ length: 60 }, (_, i) => i + 1))(
  'lets only the invocation holding the latest version write, never back in date, for seed %i',
  { timeout: 30_000 },
  run
);
