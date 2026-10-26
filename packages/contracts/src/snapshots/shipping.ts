import { z } from 'zod';
import { envelopeSchema, timestampSchema } from '../envelope.ts';
import { repoFullNameSchema } from '../projects.ts';

/** A page on github.com. A pattern rather than `z.url` so the JSON Schema checks the host too. */
export const githubUrlSchema = z
  .string()
  .max(2048)
  .regex(/^https:\/\/github\.com\/[^\s]*$/);

const dateSchema = z.iso.date();

// Wire input: repo-pulse `GET /public/feed` (ADR 0012). repo-pulse is the producer; it
// validates against schema/repo-pulse-feed.input.json. Unknown keys are dropped.

const feedEventBase = { repo: repoFullNameSchema, at: timestampSchema };

/** Event types the feed may carry. Anything else is skipped, so repo-pulse can add types. */
export const repoPulseFeedEventSchema = z.discriminatedUnion('type', [
  z.object({
    ...feedEventBase,
    type: z.literal('release.published'),
    url: githubUrlSchema,
    release: z.object({ tag: z.string().min(1).max(200) }),
  }),
  z.object({
    ...feedEventBase,
    type: z.literal('star.created'),
    /** The repository's star count right after this star. */
    star: z.object({ count: z.number().int().nonnegative() }),
  }),
  z.object({
    ...feedEventBase,
    type: z.literal('push.default_branch'),
    url: githubUrlSchema,
    push: z.object({ commits: z.number().int().nonnegative().max(10_000) }),
  }),
  z.object({
    ...feedEventBase,
    type: z.literal('pull_request.merged'),
    url: githubUrlSchema,
    pullRequest: z.object({
      number: z.number().int().positive(),
      title: z.string().min(1).max(300),
    }),
  }),
]);

/** One repository's daily star totals, oldest day first. */
export const repoPulseStarHistorySchema = z.object({
  repo: repoFullNameSchema,
  points: z.array(z.object({ date: dateSchema, stars: z.number().int().nonnegative() })).max(90),
});

/**
 * The feed as repo-pulse must produce it. The contract is closed: a new event type or field
 * is added here first, then served (ADR 0012).
 */
export const repoPulseFeedSchema = z.object({
  version: z.literal(1),
  generatedAt: timestampSchema,
  /** Public events, newest first. */
  events: z.array(repoPulseFeedEventSchema).max(100),
  /** Per public repository. */
  starHistory: z.array(repoPulseStarHistorySchema).max(50),
});

/**
 * The feed as the signals adapter reads it: the same, except that each event and each
 * star history entry is checked on its own and skipped when it does not match, so one bad
 * item does not blank the whole section.
 */
export const repoPulseFeedReaderSchema = repoPulseFeedSchema.extend({
  events: z.array(z.unknown()).max(100),
  starHistory: z.array(z.unknown()).max(50),
});

// Normalized output: what `/v1/shipping` serves.

const shippingEventBase = { repo: repoFullNameSchema, at: timestampSchema };

export const shippingEventSchema = z.discriminatedUnion('type', [
  z.object({
    ...shippingEventBase,
    type: z.literal('release'),
    url: githubUrlSchema,
    tag: z.string().min(1),
  }),
  /** Stars gained in one repository on one UTC day; `at` is the latest of them. */
  z.object({
    ...shippingEventBase,
    type: z.literal('stars'),
    gained: z.number().int().positive(),
    total: z.number().int().nonnegative(),
  }),
  z.object({
    ...shippingEventBase,
    type: z.literal('push'),
    url: githubUrlSchema,
    commits: z.number().int().nonnegative(),
  }),
  z.object({
    ...shippingEventBase,
    type: z.literal('merge'),
    url: githubUrlSchema,
    number: z.number().int().positive(),
    title: z.string().min(1),
  }),
]);

export const shippingSnapshotSchema = z.object({
  /** Up to 50 public events, newest first. */
  events: z.array(shippingEventSchema).max(50),
  starHistory: z
    .array(
      z.object({
        repo: repoFullNameSchema,
        points: z
          .array(z.object({ date: dateSchema, stars: z.number().int().nonnegative() }))
          .max(90),
      })
    )
    .max(50),
});

export type ShippingEvent = z.infer<typeof shippingEventSchema>;
export type ShippingSnapshot = z.infer<typeof shippingSnapshotSchema>;

/** The `/v1/shipping` response. */
export const shippingEnvelopeSchema = envelopeSchema(z.literal('shipping'), shippingSnapshotSchema);
