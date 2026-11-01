import { type DailySource, type SourceId, sourceIdSchema } from '@min7/contracts';
import type { PullHistory } from '../adapters/types.ts';
import { pullDaysStatement } from './daily.ts';
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

  /**
   * Stores a pull whose upstream dates its answer, with its days (ADR 0038). If the stored
   * answer is older (or there is none), the pull's `merge` combines it with what is stored, and
   * one batch writes the snapshot, the days that changed and the attempt. The snapshot write
   * is taken only if the snapshot row is still the one read, and the days only if it was taken,
   * so a write prepared from a state stored over meanwhile changes nothing; the next pull
   * brings its news again. An answer no newer than the stored one, an equally dated one
   * included (the first stored wins), is a pull that succeeded and changed nothing.
   */
  async putDated(source: DailySource, history: PullHistory, attemptAt: string): Promise<void> {
    const at = utc(history.fetchedAt);
    const attempt = utc(attemptAt);
    const [snapshot, days] = await this.db.batch([
      this.db
        .prepare('SELECT json, fetched_at, write_id FROM snapshots WHERE source = ?')
        .bind(source),
      this.db
        .prepare('SELECT day, json FROM daily WHERE source = ? AND day >= ? AND day <= ?')
        .bind(source, history.dates?.from ?? '', history.dates?.to ?? ''),
    ]);
    const row = snapshot?.results[0] as
      | { json: string | null; fetched_at: string | null; write_id: string | null }
      | undefined;
    const write: D1PreparedStatement[] = [];
    if (row?.fetched_at == null || row.fetched_at < at) {
      const stored = (days?.results ?? []) as { day: string; json: string }[];
      const merged = history.merge({
        snapshot: row?.json == null ? null : JSON.parse(row.json),
        days: new Map(stored.map(({ day, json }) => [day, json])),
      });
      const writeId = crypto.randomUUID();
      write.push(
        this.db
          .prepare(
            `INSERT INTO snapshots (source, json, fetched_at, last_success_at, last_error_code, last_attempt_at, write_id)
             VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?6)
             ON CONFLICT (source) DO UPDATE SET
               json = excluded.json, fetched_at = excluded.fetched_at,
               last_success_at = excluded.last_success_at, write_id = excluded.write_id
             WHERE snapshots.write_id IS ?7
               AND (snapshots.fetched_at IS NULL OR snapshots.fetched_at < excluded.fetched_at)`
          )
          .bind(
            source,
            JSON.stringify(merged.snapshot),
            at,
            attempt,
            Date.parse(attempt),
            writeId,
            row?.write_id ?? null
          )
      );
      if (merged.days.length > 0) {
        write.push(pullDaysStatement(this.db, source, merged.days, writeId, at, attempt));
      }
    }
    await this.db.batch([
      ...write,
      this.db
        .prepare(
          `UPDATE snapshots SET last_attempt_at = ?2, last_error_code = NULL, retry_after_at = NULL
           WHERE source = ?1`
        )
        .bind(source, Date.parse(attempt)),
    ]);
  }

  /**
   * Records that a pull began, changing nothing else: a run cut off before it records how the
   * pull ended (the CPU limit) leaves this, so the source is not due again at once.
   */
  async recordAttempt(source: SourceId, at: string): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO snapshots (source, last_attempt_at) VALUES (?1, ?2)
         ON CONFLICT (source) DO UPDATE SET last_attempt_at = excluded.last_attempt_at`
      )
      .bind(source, Date.parse(at))
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
