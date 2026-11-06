// Daily history (ADR 0038): one row per series per calendar day in the `daily` table, kept for
// good. The writes here are statements for a caller's D1 batch, so a day is stored together
// with the snapshot that brought it, or not at all.
import type { DailySource } from '@min7/contracts';
import type { Schema } from '../adapters/pull/http.ts';
import { logEvent } from '../security/log.ts';

/** One day of a series to write: its date and its JSON as the stored-day schema has it. */
export interface DailyRow {
  day: string;
  json: string;
}

/** What a pull or a backfill read of one date, before it meets what is stored. */
export interface DayValue<T> {
  date: string;
  value: T;
}

const parsed = <T>(json: string, schema: Schema<T>) => {
  try {
    const result = schema.safeParse(JSON.parse(json));
    return result.success ? result : null;
  } catch {
    return null;
  }
};

/**
 * The rows to write for `values`, given the stored JSON of their dates: each new date as it
 * is, each stored one through `merge`, and only those that change. A stored row this version
 * cannot read is left alone, since it may hold more than the new value does.
 */
export function mergedRows<T>(
  values: readonly DayValue<T>[],
  stored: ReadonlyMap<string, string>,
  schema: Schema<T>,
  merge: (date: string, stored: T, incoming: T) => T
): DailyRow[] {
  return values.flatMap(({ date, value }) => {
    const old = stored.get(date);
    if (old === undefined) return [{ day: date, json: JSON.stringify(value) }];
    const before = parsed(old, schema);
    if (before === null) {
      logEvent('warn', 'stored day unreadable', { date });
      return [];
    }
    const json = JSON.stringify(merge(date, before.data, value));
    return json === old ? [] : [{ day: date, json }];
  });
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

/** How one attempt to record a series' days went: `code` is null when every date recorded. */
export interface DayOutcome {
  date: string;
  code: string | null;
}

/** The series whose recording can fail while their snapshot carries on (ADR 0038). */
export const recordedSeries = ['listening', 'weather'] as const satisfies readonly DailySource[];

type RecordedSeries = (typeof recordedSeries)[number];

/** Whether a series is recording, as `/v1/health` shows it. */
export interface DayStatus {
  lastSuccessAt: string | null;
  lastErrorCode: string | null;
  lastErrorAt: string | null;
  lastErrorDate: string | null;
}

/** Its row in `pull_progress`, beside the pulls' own: no migration, and old Workers ignore it. */
const statusRow = (series: string) => `days:${series}`;

/**
 * Records `outcome` for `series`. A success counts only if the snapshot row carries `writeId`,
 * as its days do, and clears the error; a failure keeps `lastSuccessAt`, and nothing but a
 * later success clears it, so a working snapshot cannot hide days that are not being kept.
 */
export function dayStatusStatement(
  db: D1Database,
  series: DailySource,
  outcome: DayOutcome,
  writeId: string | null,
  at: string
): D1PreparedStatement {
  const source = statusRow(series);
  if (outcome.code === null) {
    const status: DayStatus = {
      lastSuccessAt: at,
      lastErrorCode: null,
      lastErrorAt: null,
      lastErrorDate: null,
    };
    return db
      .prepare(
        `INSERT INTO pull_progress (source, described_date, step, json)
         SELECT ?1, ?2, 1, ?3
         WHERE EXISTS (SELECT 1 FROM snapshots WHERE source = ?4 AND write_id = ?5)
         ON CONFLICT (source) DO UPDATE SET
           described_date = excluded.described_date, step = step + 1, json = excluded.json`
      )
      .bind(source, outcome.date, JSON.stringify(status), series, writeId);
  }
  const status: DayStatus = {
    lastSuccessAt: null,
    lastErrorCode: outcome.code,
    lastErrorAt: at,
    lastErrorDate: outcome.date,
  };
  return db
    .prepare(
      `INSERT INTO pull_progress (source, described_date, step, json)
       VALUES (?1, ?2, 1, ?3)
       ON CONFLICT (source) DO UPDATE SET
         described_date = excluded.described_date, step = step + 1,
         json = json_set(pull_progress.json, '$.lastErrorCode', ?4, '$.lastErrorAt', ?5,
                         '$.lastErrorDate', ?2)`
    )
    .bind(source, outcome.date, JSON.stringify(status), outcome.code, at);
}

/** Each recorded series' status; one that has recorded nothing yet is all null. */
export async function readDayStatuses(
  db: D1Database
): Promise<{ series: RecordedSeries; status: DayStatus }[]> {
  const { results } = await db
    .prepare(
      `SELECT source, json FROM pull_progress WHERE source IN (${recordedSeries.map(() => '?').join(', ')})`
    )
    .bind(...recordedSeries.map(statusRow))
    .all<{ source: string; json: string }>();
  const stored = new Map(results.map(({ source, json }) => [source, json]));
  return recordedSeries.map((series) => {
    const json = stored.get(statusRow(series));
    return {
      series,
      status:
        json === undefined
          ? { lastSuccessAt: null, lastErrorCode: null, lastErrorAt: null, lastErrorDate: null }
          : (JSON.parse(json) as DayStatus),
    };
  });
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
