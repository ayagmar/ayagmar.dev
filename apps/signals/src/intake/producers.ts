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
  /**
   * Rules across fields that the wire schema cannot state, checked after it: a fixed error
   * code for a 422, or null when the push is consistent.
   */
  check?(push: Push): string | null;
  /**
   * For a producer whose days are kept as daily history (ADR 0038): the first date of this
   * push to write once the series has any row. The days come from the stored snapshot.
   */
  historySince?(push: Push): string;
  /** Allowlist projection from a validated push to the published snapshot. */
  project(push: Push): unknown;
  /** Current and next bearer token (rotation, see docs/operations.md); unset slots never match. */
  tokens(env: Env): readonly unknown[];
  /** Current and next HMAC key for `X-Min7-Signature`, or null when the producer signs nothing. */
  signingKeys: ((env: Env) => readonly unknown[]) | null;
}

/** Plain string order. ISO dates sort correctly by it, and unlike localeCompare it needs no ICU. */
export const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
