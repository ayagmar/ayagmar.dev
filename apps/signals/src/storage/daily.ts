// Daily history (ADR 0038): one row per series per calendar day in the `daily` table, kept for
// good. The writes here are statements for a caller's D1 batch, so a day is stored together
// with the snapshot that brought it, or not at all.
import type { DailySource } from '@min7/contracts';

/** One day of a series to write: its date and its JSON as the stored-day schema has it. */
export interface DailyRow {
  day: string;
  json: string;
}

/**
 * Writes `rows` for a pulled series, all in one statement, only if the source's snapshot row
 * now carries `writeId`: that is, only if the snapshot write before it in the batch was taken
 * (ADR 0038). The rows were merged with what was stored when the write was prepared, and that
 * write is refused if anything was stored since, so they replace what is there.
 */
export function pullDaysStatement(
  db: D1Database,
  source: DailySource,
  rows: readonly DailyRow[],
  writeId: string,
  fetchedAt: string,
  now: string
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO daily (source, day, json, fetched_at, updated_at)
       SELECT ?1, json_extract(d.value, '$.day'), json_extract(d.value, '$.json'), ?3, ?4
       FROM json_each(?5) AS d
       WHERE EXISTS (SELECT 1 FROM snapshots WHERE source = ?1 AND write_id = ?2)
       ON CONFLICT (source, day) DO UPDATE SET
         json = excluded.json, fetched_at = excluded.fetched_at, updated_at = excluded.updated_at`
    )
    .bind(source, writeId, fetchedAt, now, JSON.stringify(rows));
}

/**
 * Upserts the days of the llm-usage snapshot this push stored, read back from the stored
 * snapshot rather than from the request, and only when the snapshot row carries this delivery
 * and the delivery recorded is this body: a rejected or conflicting push writes nothing.
 * Once the series has any row, only days on or after `since` are written, which bounds the
 * writes of a push (ADR 0038); the first accepted push writes every day it carries.
 *
 * A day changes only to other values from a report at least as new with at least as many
 * tokens: fewer tokens for a past day means agent logs were deleted, not that less happened.
 * Ties replace, so a repriced cost or a newly reported `activeMs` lands.
 */
export function pushedDaysStatement(
  db: D1Database,
  push: {
    producer: string;
    source: 'llm-usage';
    deliveryId: string;
    bodySha256: string;
    since: string;
    now: string;
  }
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO daily (source, day, json, fetched_at, updated_at)
       SELECT ?1, json_extract(d.value, '$.date'), json_remove(d.value, '$.date'), s.fetched_at, ?2
       FROM snapshots AS s, json_each(s.json, '$.days') AS d
       WHERE s.source = ?1 AND s.last_delivery_id = ?3
         AND EXISTS (SELECT 1 FROM push_deliveries
                     WHERE producer = ?4 AND delivery_id = ?3 AND body_sha256 = ?5)
         AND (json_extract(d.value, '$.date') >= ?6
              OR NOT EXISTS (SELECT 1 FROM daily WHERE source = ?1))
       ON CONFLICT (source, day) DO UPDATE SET
         json = excluded.json, fetched_at = excluded.fetched_at, updated_at = excluded.updated_at
       WHERE daily.fetched_at <= excluded.fetched_at
         AND daily.json IS NOT excluded.json
         AND json_extract(excluded.json, '$.totalTokens') >= json_extract(daily.json, '$.totalTokens')`
    )
    .bind(push.source, push.now, push.deliveryId, push.producer, push.bodySha256, push.since);
}

/** The stored days of `source` from `from` to `to`, oldest first, with their values parsed. */
export async function readDays(
  db: D1Database,
  source: DailySource,
  from: string,
  to: string
): Promise<{ day: string; data: unknown }[]> {
  const { results } = await db
    .prepare('SELECT day, json FROM daily WHERE source = ? AND day >= ? AND day <= ? ORDER BY day')
    .bind(source, from, to)
    .all<{ day: string; json: string }>();
  return results.map(({ day, json }) => ({ day, data: JSON.parse(json) }));
}
