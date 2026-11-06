// A bounded one-off that fills past days of listening and weather (ADR 0038). `just
// signals-backfill` arms it with a row in `pull_progress`; the Worker holds the Last.fm key, so
// nothing secret leaves it. Each cron invocation then reads one date and commits it, after
// that invocation's pull: it takes no slot from the adapters, and midnight's order is as it was.
import {
  calendarDatePattern,
  daysFirstMonth,
  listeningStoredDaySchema,
  type SourceId,
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
  hasBothSlots,
  mergeWeatherDay,
  weatherDayOf,
  weatherDayValues,
} from '../adapters/pull/weather-days.ts';
import { logEvent } from '../security/log.ts';
import { D1SnapshotStore } from '../storage/d1.ts';
import { mergedRows } from '../storage/daily.ts';
import { D1ProgressStore, type Progress } from '../storage/progress.ts';
import type { SourceStatus } from '../storage/types.ts';

/** Two requests per run, each with `getJson`'s 5 seconds; this bounds the pair. */
const runTimeoutMs = 10_000;
/** A day of 24 hourly codes is about 1 KiB. */
const archiveMaxBytes = 16 * 1024;
/** The longest range one arming may name: a little over a year, a minute a day. */
const maxDays = 400;
/** Runs in a row that may fail on one date before the backfill stops and waits for a person. */
const maxTries = 5;
/** Between tries when the upstream names no time of its own. */
const retryMs = 5 * 60_000;
/** Between tries when the archive has not reached a slot's hour: it updates every 6 hours. */
const incompleteRetryMs = 60 * 60_000;
/** Sources whose `Retry-After` also binds the backfill: the same two upstreams. */
const cooldownSources: readonly SourceId[] = ['listening', 'listening-history', 'weather'];

const dayMs = 24 * 60 * 60_000;

interface State {
  /** The date this run reads. */
  next: string;
  /** The last date, included. */
  to: string;
  /** Runs begun on `next`, counted before any work, so a killed run counts too. */
  tries: number;
  /** Unix ms before which no run asks anything or spends a try: kept here, for a restart. */
  notBefore?: number;
  /** Why the last try failed: a fixed code. */
  code?: string;
  /** Set once `tries` ran out: `next` is where it stopped. */
  stopped?: true;
}

/** The stored state if it names a bounded range of past dates in the order they go. */
function readState(value: unknown, today: string): State | undefined {
  const { next, to, tries, notBefore, code, stopped } = Object(value);
  const dates = [next, to].every((d) => typeof d === 'string' && calendarDatePattern.test(d));
  if (!dates || !Number.isInteger(tries) || tries < 0) return;
  if (next < `${daysFirstMonth}-01` || next > to || to >= today) return;
  if (Date.parse(to) - Date.parse(next) >= maxDays * dayMs) return;
  return {
    next,
    to,
    tries,
    ...(Number.isFinite(notBefore) ? { notBefore } : {}),
    ...(typeof code === 'string' ? { code } : {}),
    ...(stopped === true ? { stopped } : {}),
  };
}

/** Reads `date` from both upstreams, then commits each. Failing anywhere throws. */
async function fillDate(env: Env, date: string, now: number) {
  const apiKey = readSecret(env, 'LASTFM_API_KEY');
  if (apiKey === undefined) throw new PullError('not_configured');
  const signal = AbortSignal.timeout(runTimeoutMs);
  // One after the other: a refusal from Last.fm asks the archive nothing.
  const listening = await readListeningDay(date, apiKey, signal);
  const { values: listeningValues, failure } = listeningDayValues([listening]);
  if (failure !== undefined) throw failure.error;
  const archive = await getJson(archiveUrl(date), { signal, maxBytes: archiveMaxBytes });
  const weatherValues = weatherDayValues(date, weatherDayOf(date, archive));

  const store = new D1SnapshotStore(env.DB);
  const at = new Date(now).toISOString();
  let weatherDay: string | undefined;
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
      (stored) => {
        const rows = mergedRows(weatherValues, stored, weatherStoredDaySchema, mergeWeatherDay);
        weatherDay = rows[0]?.json ?? stored.get(date);
        return rows;
      },
      at
    ));
  // A live pull won the fence. Merges only add, so reading the date again is safe.
  if (!committed) throw new PullError('upstream_error');
  // What was there is kept, and the date stays open: only both slots finish it.
  if (!hasBothSlots(weatherDay)) throw new PullError('upstream_incomplete');
}

async function step(
  env: Env,
  statuses: ReadonlyMap<SourceId, SourceStatus>,
  now: number
): Promise<void> {
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
  if (state.stopped === true || (state.notBefore ?? 0) > now) return;
  const cooling = cooldownSources.some((id) => (statuses.get(id)?.retryAfterAt ?? 0) > now);
  if (cooling) return;
  if (state.tries >= maxTries) {
    logEvent('warn', 'backfill stopped', { date: state.next, code: state.code ?? null });
    await progress.save(loaded, describedDate, { ...state, stopped: true });
    return;
  }
  const { notBefore: _waited, ...ready } = state;
  const claim = { ...ready, tries: state.tries + 1 };
  if (!(await progress.save(loaded, describedDate, claim))) return;
  const claimed: Progress = { ...loaded, step: loaded.step + 1 };

  try {
    await fillDate(env, state.next, now);
  } catch (error) {
    if (!(error instanceof PullError)) throw error;
    logEvent('warn', 'backfill failed', { date: state.next, code: error.code });
    const wait = error.code === 'upstream_incomplete' ? incompleteRetryMs : retryMs;
    const notBefore = error.retryAt ?? now + wait;
    await progress.save(claimed, describedDate, { ...claim, notBefore, code: error.code });
    return;
  }

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
export async function runBackfill(
  env: Env,
  statuses: ReadonlyMap<SourceId, SourceStatus>,
  now: number
): Promise<void> {
  try {
    await step(env, statuses, now);
  } catch {
    logEvent('warn', 'backfill failed', { code: 'backfill_failed' });
  }
}
