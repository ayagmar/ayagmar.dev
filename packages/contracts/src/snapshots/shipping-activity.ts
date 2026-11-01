import { z } from 'zod';
import { timestampSchema } from '../envelope.ts';
import { repoFullNameSchema } from '../projects.ts';

// Wire input: repo-pulse `GET /public/activity?days=N` (ADR 0038). repo-pulse is the producer;
// it validates against schema/repo-pulse-activity.input.json. Unknown keys are dropped.

/** The most days one activity answer holds: signals asks for this many once a UTC day. */
export const activityMaxDays = 400;
/** The days signals asks for on its other pulls (ADR 0038). */
export const activityRecentDays = 35;
/** The most repositories one day lists; more sets `reposTruncated`. */
export const activityMaxRepos = 50;

const count = z.int().min(0).max(1_000_000);

/** What a day, or one repository on a day, adds up to. */
const activityCounts = {
  /** Pushes to a default branch. */
  pushes: count,
  /** Distinct commits in those pushes. */
  commits: count,
  /** Pull requests merged. */
  merges: count,
  /** Releases published. */
  releases: count,
  /** Stars given (removed stars are not subtracted). */
  stars: count,
};

export const activityRepoSchema = z.object({ repo: repoFullNameSchema, ...activityCounts });

/**
 * One UTC day as repo-pulse counts it. `repos` holds every repository active that day, sorted
 * by name, so the day's counts are their sums, unless more than 50 were active: then only the
 * 50 busiest are listed and `reposTruncated` is true, while the counts still include them all.
 */
export const repoPulseActivityDaySchema = z.object({
  date: z.iso.date(),
  ...activityCounts,
  repos: z.array(activityRepoSchema).max(activityMaxRepos),
  reposTruncated: z.boolean(),
});

/**
 * The activity answer: exactly the `days` asked for, oldest first, ending with the UTC day of
 * `generatedAt`, zero-filled. Days before `since` (when repo-pulse began recording; null for
 * nothing recorded yet) are zeros that mean "not recorded". `complete` is false when the
 * visibility gate left a repository unresolved, so the counts may be short.
 */
export const repoPulseActivitySchema = z.object({
  generatedAt: timestampSchema,
  since: z.iso.date().nullable(),
  complete: z.boolean(),
  days: z.array(repoPulseActivityDaySchema).min(1).max(activityMaxDays),
});

export type RepoPulseActivity = z.infer<typeof repoPulseActivitySchema>;
export type RepoPulseActivityDay = z.infer<typeof repoPulseActivityDaySchema>;

/**
 * The answer as the signals adapter reads it with zod: its days are checked by a hand-written
 * reader held to `repoPulseActivityDaySchema` by its tests, since zod without its compiled
 * fast path (as in workerd) takes milliseconds over 400 days (ADR 0038).
 */
export const repoPulseActivityReaderSchema = repoPulseActivitySchema.extend({
  days: z.array(z.unknown()).min(1).max(activityMaxDays),
});

/** A day of `shipping-activity` as signals keeps it in history: the upstream day without its date. */
export const shippingActivityStoredDaySchema = repoPulseActivityDaySchema.omit({ date: true });

export type ShippingActivityStoredDay = z.infer<typeof shippingActivityStoredDaySchema>;

/**
 * The `shipping-activity` snapshot: when recording began, as of the latest answer stored; the
 * repositories that may be named when history is served (with the featured projects, ADR
 * 0038); and the UTC date of the last whole 400-day answer stored. The days themselves are in
 * the history. A whole answer sets `repos` to the repositories it names on any day; a 35-day
 * answer adds those it names and drops those a stored day of its window names but it does not.
 */
export const shippingActivitySnapshotSchema = z.object({
  since: z.iso.date().nullable(),
  repos: z.array(repoFullNameSchema).max(activityMaxDays * activityMaxRepos),
  fullOn: z.iso.date().nullable(),
});

export type ShippingActivitySnapshot = z.infer<typeof shippingActivitySnapshotSchema>;

/**
 * A day of `shipping-activity` as `/v1/days` serves it. `repos` lists only repositories that
 * are public now; `reposComplete` is false when the day's counts include others (unlisted, or
 * past the 50 repo-pulse lists).
 */
export const shippingActivityDaySchema = z.object({
  date: z.iso.date(),
  ...activityCounts,
  repos: z.array(activityRepoSchema).max(activityMaxRepos),
  reposComplete: z.boolean(),
});

export type ShippingActivityDay = z.infer<typeof shippingActivityDaySchema>;
