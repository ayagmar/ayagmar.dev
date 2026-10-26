import type { SourceId } from '@min7/contracts';

/** A pull's progress as stored: the date it describes, its step and its own JSON state. */
export interface Progress {
  describedDate: string;
  step: number;
  state: unknown;
}

/**
 * Where a pull spread over several cron invocations keeps what it has read (ADR 0030), in
 * D1 rather than memory, so a restarted isolate carries on where the last invocation stopped.
 */
export class D1ProgressStore {
  constructor(
    private readonly db: D1Database,
    private readonly source: SourceId
  ) {}

  async load(): Promise<Progress | null> {
    const row = await this.db
      .prepare('SELECT described_date, step, json FROM pull_progress WHERE source = ?')
      .bind(this.source)
      .first<{ described_date: string; step: number; json: string }>();
    if (row === null) return null;
    return { describedDate: row.described_date, step: row.step, state: JSON.parse(row.json) };
  }

  /**
   * Saves `state` as step `step + 1` of `describedDate`, only if the stored progress is still
   * step `step` of that date, or belongs to another date. False when another invocation saved
   * first; its part then stands and this one is dropped.
   */
  async save(describedDate: string, step: number, state: unknown): Promise<boolean> {
    const result = await this.db
      .prepare(
        `INSERT INTO pull_progress (source, described_date, step, json) VALUES (?1, ?2, ?3 + 1, ?4)
         ON CONFLICT (source) DO UPDATE SET
           described_date = excluded.described_date, step = excluded.step, json = excluded.json
         WHERE pull_progress.described_date <> excluded.described_date OR pull_progress.step = ?3`
      )
      .bind(this.source, describedDate, step, JSON.stringify(state))
      .run();
    return result.meta.changes > 0;
  }

  async clear(): Promise<void> {
    await this.db.prepare('DELETE FROM pull_progress WHERE source = ?').bind(this.source).run();
  }
}
