import type { SourceId } from '@min7/contracts';
import type { SourceStatus } from '../storage/types.ts';

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
}
