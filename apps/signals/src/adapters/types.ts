import type { DailySource, SourceId } from '@min7/contracts';
import type { DailyRow } from '../storage/daily.ts';
import type { SourceStatus } from '../storage/types.ts';

/** What is stored for a source that keeps daily history, as a dated pull's merge reads it. */
export interface StoredHistory {
  /** The stored snapshot, or null. */
  snapshot: unknown;
  /** The stored days of the pull's dates, by date, as their stored JSON. */
  days: ReadonlyMap<string, string>;
}

/** What a pull that keeps daily history stores (ADR 0038). */
export interface PullHistory {
  /** When the upstream says its answer was true; stored as `fetchedAt` and orders answers. */
  fetchedAt: string;
  /** The answer's dates that may hold a day; what is stored for them is given to `merge`. */
  dates: { from: string; to: string } | null;
  /**
   * The snapshot to store and the days to write, given what is stored. Called only when the
   * answer is newer than the stored one; days whose JSON would not change can be left out.
   */
  merge(stored: StoredHistory): { snapshot: unknown; days: DailyRow[] };
}

/**
 * A source the Worker pulls on a schedule. `fetch` talks to the upstream and returns its
 * raw response; `normalize` is pure and turns it into the source's snapshot.
 */
export interface PullAdapter<Raw = unknown, Snapshot = unknown> {
  readonly id: SourceId;
  readonly intervalSeconds: number;
  /**
   * When the next pull is due (Unix ms), for an adapter whose schedule is not just
   * `intervalSeconds` after its last attempt. Only called once the source has been tried.
   */
  dueAt?(status: SourceStatus, now: number): number;
  fetch(env: Env, signal: AbortSignal): Promise<Raw>;
  normalize(raw: Raw): Snapshot;
  /**
   * For a source that keeps daily history (ADR 0038): what to store from the normalized pull.
   * Its days and its snapshot are written in one batch, and only over an older answer.
   */
  history?(normalized: Snapshot): PullHistory;
}

/** A pull adapter whose source keeps daily history. */
export type HistoryAdapter<Raw, Normalized> = PullAdapter<Raw, Normalized> & {
  readonly id: DailySource;
  history(normalized: Normalized): PullHistory;
};
