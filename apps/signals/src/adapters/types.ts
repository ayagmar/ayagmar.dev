import type { SourceId } from '@min7/contracts';

/**
 * A source the Worker pulls on a schedule. `fetch` talks to the upstream and returns its
 * raw response; `normalize` is pure and turns it into the source's snapshot.
 */
export interface PullAdapter<Raw = unknown, Snapshot = unknown> {
  readonly id: SourceId;
  readonly intervalSeconds: number;
  fetch(env: Env, signal: AbortSignal): Promise<Raw>;
  normalize(raw: Raw): Snapshot;
}
