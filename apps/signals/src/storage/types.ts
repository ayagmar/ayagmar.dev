import type { SourceId } from '@min7/contracts';

export interface StoredSnapshot {
  source: SourceId;
  snapshot: unknown;
  /** RFC 3339 time the snapshot was fetched or pushed. */
  fetchedAt: string;
  /** Error code of the last failed refresh since the last success, if any. */
  lastErrorCode: string | null;
}

/** Latest normalized snapshot per source. */
export interface SnapshotStore {
  get(source: SourceId): Promise<StoredSnapshot | null>;
  put(source: SourceId, snapshot: unknown, fetchedAt: string): Promise<void>;
  recordFailure(source: SourceId, code: string): Promise<void>;
}
