import { type SourceId, sourceIdSchema } from '@min7/contracts';
import type { SnapshotStore, SourceStatus, StoredSnapshot } from './types.ts';

type StatusRow = {
  source: string;
  fetched_at: string | null;
  last_success_at: string | null;
  last_error_code: string | null;
  last_attempt_at: number | null;
  described_date: unknown;
  retry_after_at: number | null;
};

const statusColumns =
  "source, fetched_at, last_success_at, last_error_code, last_attempt_at, json_extract(json, '$.describedDate') AS described_date, retry_after_at";

/** Every stored time is UTC with milliseconds, so the TEXT columns sort as instants. */
export const utc = (time: string | number) => new Date(time).toISOString();

const toStatus = (row: StatusRow): SourceStatus | null => {
  const source = sourceIdSchema.safeParse(row.source);
  if (!source.success) return null;
  return {
    source: source.data,
    fetchedAt: row.fetched_at,
    lastSuccessAt: row.last_success_at,
    lastErrorCode: row.last_error_code,
    lastAttemptAt: row.last_attempt_at,
    describedDate: typeof row.described_date === 'string' ? row.described_date : null,
    retryAfterAt: row.retry_after_at,
  };
};

export class D1SnapshotStore implements SnapshotStore {
  constructor(private readonly db: D1Database) {}

  async get(source: SourceId): Promise<StoredSnapshot | null> {
    const row = await this.db
      .prepare(`SELECT ${statusColumns}, json FROM snapshots WHERE source = ?`)
      .bind(source)
      .first<StatusRow & { json: string | null }>();
    const status = row && toStatus(row);
    if (!row || !status) return null;
    return { ...status, snapshot: row.json === null ? null : JSON.parse(row.json) };
  }

  async list(): Promise<SourceStatus[]> {
    const { results } = await this.db
      .prepare(`SELECT ${statusColumns} FROM snapshots`)
      .all<StatusRow>();
    return results.map(toStatus).filter((status) => status !== null);
  }

  /**
   * Stores a successful pull. A snapshot that names the date it describes (`describedDate`,
   * ADR 0030) never replaces one for a later date: a slow write from before midnight cannot
   * undo the new date's.
   */
  async put(source: SourceId, snapshot: unknown, fetchedAt: string): Promise<void> {
    const at = utc(fetchedAt);
    await this.db
      .prepare(
        `INSERT INTO snapshots (source, json, fetched_at, last_success_at, last_error_code, last_attempt_at)
         VALUES (?1, ?2, ?3, ?3, NULL, ?4)
         ON CONFLICT (source) DO UPDATE SET
           json = excluded.json, fetched_at = excluded.fetched_at,
           last_success_at = excluded.last_success_at, last_error_code = NULL,
           last_attempt_at = excluded.last_attempt_at, retry_after_at = NULL
         WHERE coalesce(json_extract(snapshots.json, '$.describedDate')
           > json_extract(excluded.json, '$.describedDate'), 0) = 0`
      )
      .bind(source, JSON.stringify(snapshot), at, Date.parse(at))
      .run();
  }

  /** Records a failed pull, with the upstream's `Retry-After` time if it gave one. */
  async recordFailure(
    source: SourceId,
    code: string,
    at: string,
    retryAfterAt?: number
  ): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO snapshots (source, last_error_code, last_attempt_at, retry_after_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (source) DO UPDATE SET
           last_error_code = excluded.last_error_code, last_attempt_at = excluded.last_attempt_at,
           retry_after_at = excluded.retry_after_at`
      )
      .bind(source, code, Date.parse(at), retryAfterAt ?? null)
      .run();
  }
}
