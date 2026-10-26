import { z } from 'zod';
import { type SourceId, sourceIdSchema } from './sources.ts';

/** The only contract version so far. A breaking change ships `/v2/` next to v1. */
export const contractVersion = 1;

/** RFC 3339 timestamp with an explicit offset, e.g. `2026-10-26T09:00:00Z`. */
export const timestampSchema = z.iso.datetime({ offset: true });

/**
 * Every read API response. `data` is null until the source has succeeded once;
 * `fetchedAt` is when `data` was last refreshed.
 */
export function envelopeSchema<Source extends z.ZodType<SourceId>, Data extends z.ZodType>(
  source: Source,
  data: Data
) {
  return z.object({
    source,
    version: z.literal(contractVersion),
    fetchedAt: timestampSchema.nullable(),
    stale: z.boolean(),
    data: data.nullable(),
  });
}

/** Envelope of any source with unvalidated data: what a generic consumer can rely on. */
export const anyEnvelopeSchema = envelopeSchema(sourceIdSchema, z.unknown());

export type Envelope<Data, Source extends SourceId = SourceId> = {
  source: Source;
  version: typeof contractVersion;
  fetchedAt: string | null;
  stale: boolean;
  data: Data | null;
};

/**
 * Whether a snapshot last refreshed at `lastSuccessAt` is stale at `now`.
 * Never succeeded or an unreadable timestamp counts as stale.
 */
export function isStale(
  lastSuccessAt: string | null,
  thresholdSeconds: number,
  now: Date
): boolean {
  if (lastSuccessAt === null) return true;
  const last = Date.parse(lastSuccessAt);
  if (Number.isNaN(last)) return true;
  return now.getTime() - last > thresholdSeconds * 1000;
}
