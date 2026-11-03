import type { SourceId } from '@min7/contracts';

/** A pull's progress as loaded: the version every later write of that invocation names. */
export interface Progress {
  describedDate: string;
  /** Advances on every write and is never reused, across dates and finished pulls too. */
  step: number;
  /** The saved state; null once that pull finished, undefined when the stored JSON does not parse. */
  state: unknown;
}

/**
 * Where a pull spread over several cron invocations keeps what it has read (ADR 0030), in
 * D1 rather than memory, so a restarted isolate carries on where the last invocation stopped.
 *
 * One row per source, kept for good once written. Each write is one conditional statement on
 * the version the invocation loaded (or on there being no row, if it loaded none) and on the
 * date not going back, so of invocations that loaded the same version only the first to write
 * wins, and a write held past midnight cannot replace or finish a later date's pull. A
 * finished pull leaves its date and a JSON `null`, not an empty table, so no late write can
 * find the row gone and recreate it.
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
    let state: unknown;
    try {
      state = JSON.parse(row.json);
    } catch {
      // Unreadable like a state the adapter rejects: that date starts over from this step.
    }
    return { describedDate: row.described_date, step: row.step, state };
  }

  /**
   * Saves `state` for `describedDate` over `loaded`, what this invocation's `load` returned.
   * False when another invocation wrote since, or the stored date is later: this part is
   * dropped and the stored progress stands.
   */
  save(loaded: Progress | null, describedDate: string, state: unknown): Promise<boolean> {
    return this.write(loaded, describedDate, JSON.stringify(state));
  }

  /**
   * Marks the pull of `describedDate` finished over `loaded`, as `save` does. False when it
   * lost, and then the caller must not publish what it read.
   */
  finish(loaded: Progress | null, describedDate: string): Promise<boolean> {
    return this.write(loaded, describedDate, 'null');
  }

  private async write(loaded: Progress | null, describedDate: string, json: string) {
    const statement =
      loaded === null
        ? this.db
            .prepare(
              `INSERT INTO pull_progress (source, described_date, step, json) VALUES (?1, ?2, 1, ?3)
               ON CONFLICT (source) DO NOTHING`
            )
            .bind(this.source, describedDate, json)
        : this.db
            .prepare(
              `UPDATE pull_progress SET described_date = ?2, step = step + 1, json = ?3
               WHERE source = ?1 AND step = ?4 AND described_date <= ?2`
            )
            .bind(this.source, describedDate, json, loaded.step);
    const result = await statement.run();
    return result.meta.changes > 0;
  }
}
