import type { DailySource, SourceId } from '@min7/contracts';
import type { PullHistory } from '../adapters/types.ts';

/** What signals knows about a source's freshness, without the snapshot itself. */
export interface SourceStatus {
  source: SourceId;
  /** RFC 3339 time the stored snapshot was true: fetched (pull) or `sentAt` (push). */
  fetchedAt: string | null;
  /** RFC 3339 time signals last stored a snapshot for the source. */
  lastSuccessAt: string | null;
  /** Error code of the last failed refresh since the last success, if any. */
  lastErrorCode: string | null;
  /** Unix milliseconds of the cron's last attempt (pull sources only). */
  lastAttemptAt: number | null;
  /**
   * The date the stored snapshot says it describes (`describedDate`, ADR 0030), or null for a
   * snapshot that names none.
   */
  describedDate: string | null;
  /** Unix ms before which the upstream asked not to be called again, from the last failure. */
  retryAfterAt: number | null;
}

export interface StoredSnapshot extends SourceStatus {
  /** Normalized snapshot, null until the source has succeeded once. */
  snapshot: unknown;
}

/** Latest normalized snapshot per source. Pushes are admitted by `storage/admission.ts`. */
export interface SnapshotStore {
  get(source: SourceId): Promise<StoredSnapshot | null>;
  list(): Promise<SourceStatus[]>;
  put(source: SourceId, snapshot: unknown, fetchedAt: string): Promise<void>;
  /** A dated pull and its days, only over an older one (ADR 0038). */
  putDated(source: DailySource, history: PullHistory, attemptAt: string): Promise<void>;
  recordFailure(source: SourceId, code: string, at: string, retryAfterAt?: number): Promise<void>;
}
