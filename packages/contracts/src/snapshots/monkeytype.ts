import { z } from 'zod';
import { envelopeSchema } from '../envelope.ts';
import { calendarDatePattern } from './listening-history.ts';

// Monkeytype personal bests (ADR 0033): the best time and word-count tests at the settings a
// reader expects, from `GET https://api.monkeytype.com/users/personalBests`.

// Wire input: one answer per mode, `{ message, data }`. Only the fields of a best the
// normalizer needs are declared; zod drops every other key, so a user id, a name or a field
// added later never gets past this.

/** Unix milliseconds that `Date` can still turn into a calendar date. */
const unixMs = z.int().min(0).max(253_402_300_799_999);
const percent = z.number().min(0).max(100);
const wpm = z.number().min(0);

/**
 * One personal best as Monkeytype stores it (`PersonalBestSchema` in its repository). The
 * three booleans are optional there and absent means false, as its own matching reads them.
 * A best that does not parse fails the pull: an unreadable record is not an empty account.
 */
export const monkeytypePersonalBestSchema = z.object({
  wpm,
  acc: percent,
  raw: wpm,
  consistency: percent,
  /** When the best was set, in Unix milliseconds (`Date.now()` upstream). */
  timestamp: unixMs,
  language: z.string(),
  difficulty: z.string(),
  punctuation: z.boolean().optional(),
  numbers: z.boolean().optional(),
  lazyMode: z.boolean().optional(),
});

export type MonkeytypePersonalBest = z.infer<typeof monkeytypePersonalBestSchema>;

/** The bests of one test length, one per combination of settings. */
export const monkeytypeBucketSchema = z.array(monkeytypePersonalBestSchema);

/**
 * `?mode=time` or `?mode=words`: `data` maps each test length (seconds or words, as a string)
 * to its bests, or is null for an account with none in that mode. The docs' example shows a
 * single best there; the server sends this map (ADR 0033). The map is checked whole, so an
 * answer in the documented shape fails instead of reading as an account with no bests; the
 * bests are checked only in the lengths the normalizer reads (`monkeytypeBucketSchema`).
 */
export const monkeytypeBestsSchema = z.object({
  data: z.record(z.string().regex(/^\d{1,6}$/), z.array(z.unknown())).nullable(),
});

// Normalized output: what `/v1/monkeytype` serves.

/**
 * The best at one test length: the record with the highest WPM, and its other numbers from
 * that same record. `date` is the UTC day it was set, not when signals fetched it.
 */
const bestSchema = z
  .object({
    wpm,
    /** Accuracy, percent. */
    acc: percent,
    raw: wpm,
    /** Consistency, percent. */
    consistency: percent,
    date: z.string().regex(calendarDatePattern),
  })
  .nullable();

export type TypingBest = z.infer<typeof bestSchema>;

/**
 * Personal bests in English, normal difficulty, without punctuation, numbers or lazy mode.
 * Each slot is null when there is no best at those settings; a missing one is never 0.
 */
export const monkeytypeSnapshotSchema = z.object({
  /** By test length in seconds. */
  time: z.object({ '15': bestSchema, '30': bestSchema, '60': bestSchema, '120': bestSchema }),
  /** By test length in words. */
  words: z.object({ '10': bestSchema, '25': bestSchema, '50': bestSchema, '100': bestSchema }),
});

export type MonkeytypeSnapshot = z.infer<typeof monkeytypeSnapshotSchema>;

/** The `/v1/monkeytype` response. */
export const monkeytypeEnvelopeSchema = envelopeSchema(
  z.literal('monkeytype'),
  monkeytypeSnapshotSchema
);
