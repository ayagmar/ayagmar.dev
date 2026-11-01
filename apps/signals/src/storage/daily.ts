// Daily history (ADR 0038): one row per series per calendar day in the `daily` table, kept for
// good. The writes here are statements for a caller's D1 batch, so a day is stored together
// with the snapshot that brought it, or not at all.
import type { DailySource } from '@min7/contracts';

/**
 * What a day's size is measured by. A day is only ever replaced by one at least as large: a
 * smaller count for a past day means the upstream lost data or left something out (a gated
 * repository, a deleted agent log), not that less happened (ADR 0038).
 */
const size: Record<DailySource, (json: string) => string> = {
  'shipping-activity': (json) =>
    `(json_extract(${json}, '$.pushes') + json_extract(${json}, '$.commits') + json_extract(${json}, '$.merges') + json_extract(${json}, '$.releases') + json_extract(${json}, '$.stars'))`,
  'llm-usage': (json) => `json_extract(${json}, '$.totalTokens')`,
};

/**
 * The rule every write follows when the day exists: a report at least as new (each series
 * only lets through reports at least as new as every earlier one, so this also holds for
 * rows the newest report left as they were), with other values, of at least the same size.
 * Identical values change nothing, not even `updated_at`.
 */
const onConflict = (source: DailySource) => `
  ON CONFLICT (source, day) DO UPDATE SET
    json = excluded.json, fetched_at = excluded.fetched_at, updated_at = excluded.updated_at
  WHERE daily.fetched_at <= excluded.fetched_at
    AND daily.json IS NOT excluded.json
    AND ${size[source]('excluded.json')} >= ${size[source]('daily.json')}`;

/** One day of a series to write: its date and its values as the stored-day schema has them. */
export interface DailyRow {
  day: string;
  data: unknown;
}

/**
 * Upserts `rows` for a pulled series, all in one statement, only if the source's snapshot row
 * now carries `fetchedAt`: that is, the snapshot upsert before it in the batch took this
 * report, or an equally dated one is already there. An older report is refused whole.
 */
export function pullDaysStatement(
  db: D1Database,
  source: DailySource,
  rows: readonly DailyRow[],
  fetchedAt: string,
  now: string
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO daily (source, day, json, fetched_at, updated_at)
       SELECT ?1, json_extract(d.value, '$.day'), json_extract(d.value, '$.data'), ?2, ?3
       FROM json_each(?4) AS d
       WHERE EXISTS (SELECT 1 FROM snapshots WHERE source = ?1 AND fetched_at = ?2)
       ${onConflict(source)}`
    )
    .bind(source, fetchedAt, now, JSON.stringify(rows));
}

/**
 * Upserts the days of the llm-usage snapshot this push stored, read back from the stored
 * snapshot rather than from the request, and only when the snapshot row carries this delivery
 * and the delivery recorded is this body: a rejected or conflicting push writes nothing.
 * Once the series has any row, only days on or after `since` are written, which bounds the
 * writes of a push (ADR 0038); the first accepted push writes every day it carries.
 */
export function pushedDaysStatement(
  db: D1Database,
  push: {
    producer: string;
    source: DailySource;
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
       ${onConflict(push.source)}`
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
