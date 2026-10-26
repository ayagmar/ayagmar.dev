import type { PullAdapter } from '../adapters/types.ts';
import { logEvent } from '../security/log.ts';
import { deleteDeliveriesBefore } from '../storage/admission.ts';
import { D1SnapshotStore } from '../storage/d1.ts';
import type { SnapshotStore } from '../storage/types.ts';

/** Adapters fetched at the same time. */
const concurrency = 4;
/** An upstream call that takes longer than this is abandoned and recorded as `timeout`. */
const fetchTimeoutMs = 20_000;
/**
 * A due check allows this much early: the cron fires once a minute, and a fetch that ended a
 * few seconds into the previous minute must not push the next one back a whole minute.
 */
const scheduleSlackMs = 30_000;
/** Deliveries older than this are forgotten; ADR 0011 explains why that is safe. */
const deliveryRetentionMs = 7 * 24 * 60 * 60 * 1000;

const errorCodePattern = /^[a-z][a-z0-9_]{0,63}$/;

/**
 * A short code for a failed pull. Only an adapter's own `code` property (a fixed identifier
 * it chose) is kept; the error's message never is, since it can hold an upstream body or URL.
 */
function errorCode(error: unknown, fallback: string): string {
  if (error instanceof DOMException && error.name === 'TimeoutError') return 'timeout';
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && errorCodePattern.test(code) ? code : fallback;
}

async function pull(adapter: PullAdapter, env: Env, store: SnapshotStore): Promise<void> {
  let stage = 'fetch_failed';
  try {
    const raw = await adapter.fetch(env, AbortSignal.timeout(fetchTimeoutMs));
    stage = 'normalize_failed';
    const snapshot = adapter.normalize(raw);
    stage = 'store_failed';
    await store.put(adapter.id, snapshot, new Date().toISOString());
  } catch (error) {
    const code = errorCode(error, stage);
    logEvent('warn', 'pull failed', { source: adapter.id, code });
    await store.recordFailure(adapter.id, code, new Date().toISOString());
  }
}

/**
 * One cron run: every adapter whose interval has passed since its last attempt, at most
 * `concurrency` at a time, then old push deliveries in bounded batches.
 */
export async function runScheduled(
  env: Env,
  adapters: readonly PullAdapter[],
  scheduledTime: number
): Promise<void> {
  const store = new D1SnapshotStore(env.DB);
  const lastAttempt = new Map((await store.list()).map((s) => [s.source, s.lastAttemptAt]));
  const due = adapters.filter((adapter) => {
    const last = lastAttempt.get(adapter.id);
    return last == null || scheduledTime - last >= adapter.intervalSeconds * 1000 - scheduleSlackMs;
  });

  for (let start = 0; start < due.length; start += concurrency) {
    await Promise.all(due.slice(start, start + concurrency).map((a) => pull(a, env, store)));
  }

  const deleted = await deleteDeliveriesBefore(env.DB, scheduledTime - deliveryRetentionMs, {
    batchSize: 500,
    maxBatches: 10,
  });
  logEvent('log', 'cron run', { pulled: due.length, deliveriesDeleted: deleted });
}
