// A bounded one-off that fills past days of listening and weather (ADR 0038). `just
// signals-backfill` arms it with a row in `pull_progress`; the Worker holds the Last.fm key, so
// nothing secret leaves it. Each cron invocation then reads one date and commits it, after
// that invocation's pull: it takes no slot from the adapters, and midnight's order is as it was.
import {
  calendarDatePattern,
  daysFirstMonth,
  listeningStoredDaySchema,
  weatherStoredDaySchema,
} from '@min7/contracts';
import { nextDate, rabatDate } from '@min7/contracts/rabat';
import { getJson, PullError } from '../adapters/pull/http.ts';
import {
  listeningDayValues,
  mergeListeningDay,
  readListeningDay,
} from '../adapters/pull/listening-days.ts';
import { readSecret } from '../adapters/pull/secrets.ts';
import {
  archiveUrl,
  mergeWeatherDay,
  weatherDayOf,
  weatherDayValues,
} from '../adapters/pull/weather-days.ts';
import { logEvent } from '../security/log.ts';
import { D1SnapshotStore } from '../storage/d1.ts';
import { mergedRows } from '../storage/daily.ts';
import { D1ProgressStore, type Progress } from '../storage/progress.ts';

/** Two requests per run, each with `getJson`'s 5 seconds; this bounds the pair. */
const runTimeoutMs = 10_000;
/** A day of 24 hourly codes is about 1 KiB. */
const archiveMaxBytes = 16 * 1024;
/** The longest range one arming may name: a little over a year, a minute a day. */
const maxDays = 400;
/** Runs in a row that may fail on one date before the backfill stops and waits for a person. */
const maxTries = 5;

const dayMs = 24 * 60 * 60_000;

interface State {
  /** The date this run reads. */
  next: string;
  /** The last date, included. */
  to: string;
  /** Runs begun on `next`, counted before any work, so a killed run counts too. */
  tries: number;
  /** Set once `tries` ran out: `next` is where it stopped. */
  stopped?: true;
}

/** The stored state if it names a bounded range of past dates in the order they go. */
function readState(value: unknown, today: string): State | undefined {
  const { next, to, tries, stopped } = Object(value);
  const dates = [next, to].every((d) => typeof d === 'string' && calendarDatePattern.test(d));
  if (!dates || !Number.isInteger(tries) || tries < 0) return;
  if (next < `${daysFirstMonth}-01` || next > to || to >= today) return;
  if (Date.parse(to) - Date.parse(next) >= maxDays * dayMs) return;
  return { next, to, tries, ...(stopped === true ? { stopped } : {}) };
}

/** Reads `date` from both upstreams, then commits each. Failing anywhere throws. */
async function fillDate(env: Env, date: string, now: number) {
  const apiKey = readSecret(env, 'LASTFM_API_KEY');
  if (apiKey === undefined) throw new PullError('not_configured');
  const signal = AbortSignal.timeout(runTimeoutMs);
  const [listening, archive] = await Promise.all([
    readListeningDay(date, apiKey, signal),
    getJson(archiveUrl(date), { signal, maxBytes: archiveMaxBytes }),
  ]);
  const listeningValues = listeningDayValues([listening]);
  if (listeningValues.length === 0) throw new PullError('upstream_error');
  const weatherValues = weatherDayValues(date, weatherDayOf(date, archive));

  const store = new D1SnapshotStore(env.DB);
  const at = new Date(now).toISOString();
  const committed =
    (await store.mergeDays(
      'listening',
      date,
      (stored) => mergedRows(listeningValues, stored, listeningStoredDaySchema, mergeListeningDay),
      at
    )) &&
    (await store.mergeDays(
      'weather',
      date,
      (stored) => mergedRows(weatherValues, stored, weatherStoredDaySchema, mergeWeatherDay),
      at
    ));
  // A live pull won the fence. Merges only add, so reading the date again is safe.
  if (!committed) throw new PullError('upstream_error');
}

async function step(env: Env, now: number): Promise<void> {
  const progress = new D1ProgressStore(env.DB, 'daily-backfill');
  const loaded = await progress.load();
  if (loaded === null || loaded.state === null) return;
  const { describedDate } = loaded;
  const state = readState(loaded.state, rabatDate(now));
  if (state === undefined) {
    logEvent('warn', 'backfill refused', { code: 'invalid_range' });
    await progress.finish(loaded, describedDate);
    return;
  }
  if (state.stopped === true) return;
  if (state.tries >= maxTries) {
    logEvent('warn', 'backfill stopped', { date: state.next });
    await progress.save(loaded, describedDate, { ...state, stopped: true });
    return;
  }
  const claim = { ...state, tries: state.tries + 1 };
  if (!(await progress.save(loaded, describedDate, claim))) return;
  const claimed: Progress = { ...loaded, step: loaded.step + 1 };

  await fillDate(env, state.next, now);

  logEvent('log', 'backfill day', { date: state.next });
  if (state.next === state.to) await progress.finish(claimed, describedDate);
  else {
    await progress.save(claimed, describedDate, {
      next: nextDate(state.next),
      to: state.to,
      tries: 0,
    });
  }
}

/**
 * One date of an armed backfill, if any. A failure leaves the date to the next run and is only
 * logged, as this must not fail the run that already did its pull. A date is the unit: a run
 * killed halfway repeats it, and the merges make that change nothing.
 */
export async function runBackfill(env: Env, now: number): Promise<void> {
  try {
    await step(env, now);
  } catch (error) {
    const code = error instanceof PullError ? error.code : 'backfill_failed';
    logEvent('warn', 'backfill failed', { code });
  }
}
