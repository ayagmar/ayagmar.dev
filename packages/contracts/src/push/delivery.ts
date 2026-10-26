import { z } from 'zod';
import { timestampSchema } from '../envelope.ts';

/** Producers that push to signals, each on its own route: `POST /v1/push/<producer>`. */
export const producerIds = ['llm-usage', 'trellis'] as const;

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
