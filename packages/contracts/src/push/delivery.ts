import { z } from 'zod';
import { timestampSchema } from '../envelope.ts';

/** Producers that push to signals, each on its own route: `POST /v1/push/<producer>`. */
export const producerIds = ['llm-usage', 'trellis', 'desktop'] as const;

export type ProducerId = (typeof producerIds)[number];

/** Largest request body signals reads, in bytes. A longer body is rejected before parsing. */
export const maxPushBodyBytes = 64 * 1024;

/**
 * Every push body. `deliveryId` is the idempotency key: a retry sends the same id and the
 * same bytes. `sentAt` is when the producer took its snapshot, and is served as `fetchedAt`.
 */
export function pushDeliverySchema<Producer extends ProducerId, Payload extends z.ZodType>(
  producer: Producer,
  payload: Payload
) {
  return z.object({
    producer: z.literal(producer),
    deliveryId: z.uuid(),
    sentAt: timestampSchema,
    payload,
  });
}

// Bounds shared by the push payloads. They reject nonsense, not unusual weeks.
export const usdSchema = z.number().min(0).max(1_000_000);
export const tokenCountSchema = z.int().min(0).max(1_000_000_000_000_000);
export const dayCountSchema = z.int().min(0).max(36_600);

/**
 * Estimated agent time on one local calendar day in Africa/Casablanca, in milliseconds
 * (ADR 0014). A local day can last 25 hours when the clocks go back, so the bound is 25 h,
 * not 24; the totals allow 7 and 31 such days.
 */
export const maxActiveMsPerDay = 25 * 60 * 60 * 1000;
export const dayActiveMsSchema = z.int().min(0).max(maxActiveMsPerDay);
export const weekActiveMsSchema = z
  .int()
  .min(0)
  .max(7 * maxActiveMsPerDay);
export const monthActiveMsSchema = z
  .int()
  .min(0)
  .max(31 * maxActiveMsPerDay);
