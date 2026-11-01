import { isDailySource, type ProducerId, type SourceId } from '@min7/contracts';
import { pushedDaysStatement } from './daily.ts';

export interface PushAdmission {
  producer: ProducerId;
  source: SourceId;
  deliveryId: string;
  bodySha256: string;
  /** Normalized snapshot JSON, already projected through the allowlist. */
  snapshotJson: string;
  /** The producer's `sentAt`, as UTC from `utc()`. */
  fetchedAt: string;
  /** Unix milliseconds the request was received. */
  receivedAt: number;
  minIntervalMs: number;
  /**
   * For a source that keeps daily history (ADR 0038): the first date of the stored snapshot's
   * days to write once the series has a row.
   */
  historySince?: string;
}

export type AdmissionResult =
  | { outcome: 'accepted' }
  | { outcome: 'duplicate' }
  | { outcome: 'conflict' }
  | { outcome: 'older_than_current' }
  | { outcome: 'too_soon'; retryAfterSeconds: number };

/**
 * The outcome for a delivery id seen before: `duplicate` when the body is byte-identical,
 * `conflict` when it differs, null when the id is new (or older than the 7-day retention).
 */
export async function findDelivery(
  db: D1Database,
  producer: ProducerId,
  deliveryId: string,
  bodySha256: string
): Promise<AdmissionResult | null> {
  const row = await db
    .prepare('SELECT body_sha256 FROM push_deliveries WHERE producer = ? AND delivery_id = ?')
    .bind(producer, deliveryId)
    .first<{ body_sha256: string }>();
  if (!row) return null;
  return { outcome: row.body_sha256 === bodySha256 ? 'duplicate' : 'conflict' };
}

/**
 * Stores the snapshot and records the delivery in one D1 batch (one transaction), or does
 * neither; for a source with daily history, the same batch writes the stored snapshot's days.
 * The snapshot upsert only takes effect when the delivery id is unseen, the minimum
 * interval since the last accepted push has passed, and the snapshot is not older than the
 * stored one. The delivery row is inserted only if the upsert took effect, which it detects
 * by the delivery id the upsert writes into the snapshot row. A zero-row upsert is a
 * successful statement in D1, so the second statement's condition, not a rollback, is what
 * keeps a rejected delivery from leaving a row behind.
 */
export async function admitPush(db: D1Database, push: PushAdmission): Promise<AdmissionResult> {
  const lastSuccessAt = new Date(push.receivedAt).toISOString();
  const [upsert] = await db.batch([
    db
      .prepare(
        `INSERT INTO snapshots
           (source, json, fetched_at, last_success_at, last_error_code, last_push_at, last_delivery_id)
         SELECT ?1, ?2, ?3, ?4, NULL, ?5, ?6
         WHERE NOT EXISTS (SELECT 1 FROM push_deliveries WHERE producer = ?7 AND delivery_id = ?6)
         ON CONFLICT (source) DO UPDATE SET
           json = excluded.json, fetched_at = excluded.fetched_at,
           last_success_at = excluded.last_success_at, last_error_code = NULL,
           last_push_at = excluded.last_push_at, last_delivery_id = excluded.last_delivery_id
         WHERE (snapshots.last_push_at IS NULL OR snapshots.last_push_at <= excluded.last_push_at - ?8)
           AND (snapshots.fetched_at IS NULL OR snapshots.fetched_at <= excluded.fetched_at)`
      )
      .bind(
        push.source,
        push.snapshotJson,
        push.fetchedAt,
        lastSuccessAt,
        push.receivedAt,
        push.deliveryId,
        push.producer,
        push.minIntervalMs
      ),
    db
      .prepare(
        `INSERT INTO push_deliveries (producer, delivery_id, body_sha256, received_at)
         SELECT ?1, ?2, ?3, ?4
         WHERE EXISTS (SELECT 1 FROM snapshots WHERE source = ?5 AND last_delivery_id = ?2)
         ON CONFLICT (producer, delivery_id) DO NOTHING`
      )
      .bind(push.producer, push.deliveryId, push.bodySha256, push.receivedAt, push.source),
    // 3. The days of the snapshot now stored, only if it is this delivery's (ADR 0038).
    ...(push.historySince !== undefined && isDailySource(push.source)
      ? [
          pushedDaysStatement(db, {
            producer: push.producer,
            source: push.source,
            deliveryId: push.deliveryId,
            bodySha256: push.bodySha256,
            since: push.historySince,
            now: lastSuccessAt,
          }),
        ]
      : []),
  ]);
  if (upsert?.meta.changes === 1) return { outcome: 'accepted' };
  return explainRejection(db, push);
}

/**
 * Why a batch changed nothing. Read after the batch, so a concurrent push can make the
 * reason less precise (too_soon instead of older_than_current), never turn a rejection into
 * an acceptance: both store nothing.
 */
async function explainRejection(db: D1Database, push: PushAdmission): Promise<AdmissionResult> {
  const seen = await findDelivery(db, push.producer, push.deliveryId, push.bodySha256);
  if (seen) return seen;
  const current = await db
    .prepare('SELECT fetched_at, last_push_at FROM snapshots WHERE source = ?')
    .bind(push.source)
    .first<{ fetched_at: string | null; last_push_at: number | null }>();
  if (current?.fetched_at && current.fetched_at > push.fetchedAt) {
    return { outcome: 'older_than_current' };
  }
  const nextAllowed = (current?.last_push_at ?? 0) + push.minIntervalMs;
  return {
    outcome: 'too_soon',
    retryAfterSeconds: Math.max(1, Math.ceil((nextAllowed - push.receivedAt) / 1000)),
  };
}

/** Deletes deliveries received before `before` (Unix ms), at most `batchSize` rows per query. */
export async function deleteDeliveriesBefore(
  db: D1Database,
  before: number,
  { batchSize, maxBatches }: { batchSize: number; maxBatches: number }
): Promise<number> {
  let deleted = 0;
  for (let batch = 0; batch < maxBatches; batch++) {
    const { meta } = await db
      .prepare(
        `DELETE FROM push_deliveries WHERE rowid IN
           (SELECT rowid FROM push_deliveries WHERE received_at < ? ORDER BY received_at LIMIT ?)`
      )
      .bind(before, batchSize)
      .run();
    deleted += meta.changes;
    if (meta.changes < batchSize) break;
  }
  return deleted;
}
