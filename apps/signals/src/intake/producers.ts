import type { ProducerId, SourceId } from '@min7/contracts';
import type { z } from 'zod';

/** One push producer: how it authenticates, what it may send, and what gets published. */
export interface Producer<Push extends { deliveryId: string; sentAt: string }> {
  id: ProducerId;
  /** The source whose snapshot an accepted push replaces. */
  source: SourceId;
  /** Wire schema: strict types and ranges, unknown keys stripped at every level. */
  schema: z.ZodType<Push>;
  snapshotSchema: z.ZodType;
  /** Allowlist projection from a validated push to the published snapshot. */
  project(push: Push): unknown;
  /** Current and next bearer token (rotation, see docs/operations.md); unset slots never match. */
  tokens(env: Env): readonly unknown[];
  /** Current and next HMAC key for `X-Min7-Signature`, or null when the producer signs nothing. */
  signingKeys: ((env: Env) => readonly unknown[]) | null;
}

/** Plain string order. ISO dates sort correctly by it, and unlike localeCompare it needs no ICU. */
export const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
