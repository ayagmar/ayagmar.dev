import { isDailySource } from '@min7/contracts';
import { PullError } from '../adapters/pull/http.ts';
import type { PullAdapter } from '../adapters/types.ts';
import { logEvent } from '../security/log.ts';
import { deleteDeliveriesBefore } from '../storage/admission.ts';
import { D1SnapshotStore } from '../storage/d1.ts';
import type { SnapshotStore, SourceStatus } from '../storage/types.ts';

/** An upstream call that takes longer than this is abandoned and recorded as `timeout`. */
const fetchTimeoutMs = 20_000;
/**
 * A due check allows this much early: the cron fires once a minute, and a fetch that ended a
 * few seconds into the previous minute must not push the next one back a whole minute.
 */
const scheduleSlackMs = 30_000;
/** Deliveries older than this are forgotten; ADR 0011 explains why that is safe. */
const deliveryRetentionMs = 7 * 24 * 60 * 60 * 1000;

/** An upstream's own date for its answer may run this far ahead of the Worker's clock. */
const maxAheadMs = 5 * 60_000;

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

/** The adapter's own `retryAt` property: the upstream's `Retry-After` time, if it gave one. */
function retryAt(error: unknown): number | undefined {
  const at = (error as { retryAt?: unknown } | null)?.retryAt;
  return typeof at === 'number' && Number.isFinite(at) ? at : undefined;
}

async function pull(
  adapter: PullAdapter,
  env: Env,
  store: SnapshotStore,
  previous: SourceStatus | undefined
): Promise<void> {
  // Recorded first: Workers ends a run over its CPU limit without running the catch below, and
  // a pull with no attempt recorded would be the most overdue at every run after (ADR 0038).
  await store.recordAttempt(adapter.id, new Date().toISOString());
  let stage = 'fetch_failed';
  try {
    const raw = await adapter.fetch(env, AbortSignal.timeout(fetchTimeoutMs), previous);
    stage = 'normalize_failed';
    const snapshot = adapter.normalize(raw);
    const history = adapter.history?.(snapshot);
    if (history === undefined) {
      stage = 'store_failed';
      await store.put(adapter.id, snapshot, new Date().toISOString());
      return;
    }
    // An answer dated in the future would outrank every real one after it (ADR 0038).
    const now = Date.now();
    if (!isDailySource(adapter.id) || !(Date.parse(history.fetchedAt) <= now + maxAheadMs)) {
      throw new PullError('upstream_malformed');
    }
    stage = 'store_failed';
    await store.putDated(adapter.id, history, new Date(now).toISOString());
  } catch (error) {
    const code = errorCode(error, stage);
    // A pull spread over several invocations that read its part (ADR 0030) did not fail.
    if (code === 'in_progress') logEvent('log', 'pull in progress', { source: adapter.id });
    else logEvent('warn', 'pull failed', { source: adapter.id, code });
    await store.recordFailure(adapter.id, code, new Date().toISOString(), retryAt(error));
  }
}

/**
 * One cron run: at most one pull adapter, then old push deliveries in bounded batches.
 * Workers Free allows 10 ms of CPU and 50 subrequests per invocation, and one cold adapter
 * can need most of that (ADR 0009), so adapters never share an invocation. The one that runs
 * is the most overdue: never tried first, then the one furthest past the time it is due,
 * `intervalSeconds` after its last attempt unless the adapter's `dueAt` says otherwise, and
 * never before a time the upstream gave in `Retry-After`. A
 * source pulled every minute therefore skips a minute now and then, and none waits behind it.
 */
export async function runScheduled(
  env: Env,
  adapters: readonly PullAdapter[],
  scheduledTime: number
): Promise<void> {
  const store = new D1SnapshotStore(env.DB);
  const statuses = new Map((await store.list()).map((s) => [s.source, s]));
  let next: { adapter: PullAdapter; overdueMs: number } | undefined;
  for (const adapter of adapters) {
    const status = statuses.get(adapter.id);
    // Never before the time an upstream asked for, with no early allowance (ADR 0030).
    if (status?.retryAfterAt != null && scheduledTime < status.retryAfterAt) continue;
    const last = status?.lastAttemptAt;
    const overdueMs =
      status === undefined || last == null
        ? Number.POSITIVE_INFINITY
        : scheduledTime -
          (adapter.dueAt?.(status, scheduledTime) ?? last + adapter.intervalSeconds * 1000);
    if (overdueMs >= -scheduleSlackMs && (next === undefined || overdueMs > next.overdueMs)) {
      next = { adapter, overdueMs };
    }
  }
  if (next) await pull(next.adapter, env, store, statuses.get(next.adapter.id));

  const deleted = await deleteDeliveriesBefore(env.DB, scheduledTime - deliveryRetentionMs, {
    batchSize: 500,
    maxBatches: 10,
  });
  logEvent('log', 'cron run', { pulled: next?.adapter.id ?? null, deliveriesDeleted: deleted });
}
