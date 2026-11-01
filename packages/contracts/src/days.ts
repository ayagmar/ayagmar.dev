// Daily history (ADR 0038): one row per series per calendar day, kept for good, served by
// `GET /v1/days/<series>` in fixed blocks.
import { z } from 'zod';
import { envelopeSchema } from './envelope.ts';
import { rabatTimeZone } from './rabat.ts';
import { llmUsageDaySchema } from './snapshots/llm-usage.ts';
import { shippingActivityDaySchema } from './snapshots/shipping-activity.ts';

/** Sources that keep daily history, each a series of `/v1/days`. */
export const dailySources = ['shipping-activity', 'llm-usage'] as const;

export type DailySource = (typeof dailySources)[number];

export const isDailySource = (value: string): value is DailySource =>
  (dailySources as readonly string[]).includes(value);

/**
 * The zone each series' calendar days are in. repo-pulse counts UTC days; llm-usage-metrics
 * counts local days in Rabat (ADR 0014), which cannot be turned into UTC days.
 */
export const dailyZones = {
  'shipping-activity': 'UTC',
  'llm-usage': rabatTimeZone,
} as const satisfies Record<DailySource, string>;

/** The earliest `?month=` served: llm-usage's first push reaches 53 weeks back from late 2026. */
export const daysFirstMonth = '2025-01';

/** `?last=` takes only this many days: the strips' length. */
export const daysLast = 28;

/**
 * One block of a series: the days from `from` to `to` (in the series' zone) that have a
 * record, oldest first, one per date. A date in the block without an entry was not recorded.
 */
const block = <Zone extends string, Day extends z.ZodType>(zone: Zone, day: Day) =>
  z.object({
    zone: z.literal(zone),
    from: z.iso.date(),
    to: z.iso.date(),
    days: z.array(day).max(31),
  });

/** `/v1/days/shipping-activity`. */
export const shippingActivityDaysEnvelopeSchema = envelopeSchema(
  z.literal('shipping-activity'),
  block(dailyZones['shipping-activity'], shippingActivityDaySchema)
);

/** `/v1/days/llm-usage`. */
export const llmUsageDaysEnvelopeSchema = envelopeSchema(
  z.literal('llm-usage'),
  block(dailyZones['llm-usage'], llmUsageDaySchema)
);

export type ShippingActivityDays = NonNullable<
  z.infer<typeof shippingActivityDaysEnvelopeSchema>['data']
>;
export type LlmUsageDays = NonNullable<z.infer<typeof llmUsageDaysEnvelopeSchema>['data']>;
