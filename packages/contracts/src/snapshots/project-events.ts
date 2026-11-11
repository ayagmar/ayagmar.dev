import { z } from 'zod';
import { envelopeSchema, timestampSchema } from '../envelope.ts';
import { projectSlugSchema, repoFullNameSchema } from '../projects.ts';
import { githubUrlSchema, shippingMergeSchema, shippingReleaseSchema } from './shipping.ts';

// Wire input: one GitHub GraphQL answer with an alias per featured project (ADR 0046). Only the
// fields the normalizer reads are declared; zod drops every other key.

/** Releases a project's log keeps, and asks GitHub for. */
export const projectReleasesKept = 10;
/** Merged pull requests a project's log keeps. */
export const projectMergesKept = 10;
/**
 * Merged pull requests asked for: GitHub orders them by update, not by merge, and some are
 * dependency bots', so more are asked than kept (ADR 0046).
 */
export const projectMergesAsked = 20;

/** One alias of the answer: a repository GitHub answered for. Nodes are read one by one. */
export const githubProjectRepoSchema = z.object({
  nameWithOwner: repoFullNameSchema,
  isPrivate: z.boolean(),
  releases: z.object({ nodes: z.array(z.unknown()).max(projectReleasesKept) }),
  pullRequests: z.object({ nodes: z.array(z.unknown()).max(projectMergesAsked) }),
});

/** A release node. `publishedAt` is null for a draft, which is never shown. */
export const githubReleaseNodeSchema = z.object({
  tagName: z.string().min(1).max(200),
  url: githubUrlSchema,
  createdAt: timestampSchema,
  publishedAt: timestampSchema.nullable(),
});

/** A merged pull request node. */
export const githubMergedPullSchema = z.object({
  number: z.number().int().positive(),
  title: z.string().min(1).max(300),
  url: githubUrlSchema,
  mergedAt: timestampSchema,
  updatedAt: timestampSchema,
  /** null for a deleted account. Read only to leave dependency bots out; never stored. */
  author: z.object({ login: z.string().min(1).max(100) }).nullable(),
});

/** One item of the answer's `errors`; an item that does not match is skipped. */
export const githubGraphqlErrorSchema = z.object({
  type: z.string().max(100).optional(),
  path: z
    .array(z.union([z.string().max(100), z.number()]))
    .max(10)
    .optional(),
});

/** The answer. `errors` is read item by item, so one odd item cannot fail the whole answer. */
export const githubGraphqlAnswerSchema = z.object({
  data: z.record(z.string(), z.unknown()).nullable().optional(),
  errors: z.array(z.unknown()).optional(),
});

// Normalized output: what `/v1/project-events` serves.

/** An entry of a project's log: exactly a `/v1/shipping` release or merge. */
export const projectEventSchema = z.discriminatedUnion('type', [
  shippingReleaseSchema,
  shippingMergeSchema,
]);

export const projectEventsSnapshotSchema = z.object({
  /**
   * The featured projects whose repository GitHub answered as public and the owner's, in the
   * order the owner listed them. A project missing here is private, deleted or moved to
   * another account: its log is not shown.
   */
  projects: z
    .array(
      z.object({
        slug: projectSlugSchema,
        /** `owner/name` as GitHub reports it now (after a rename). */
        repo: repoFullNameSchema,
        /**
         * The newest releases and merged pull requests (dependency bots' left out), up to 10
         * of each, newest first. Empty: none yet.
         */
        events: z.array(projectEventSchema).max(projectReleasesKept + projectMergesKept),
      })
    )
    .max(30),
});

export type ProjectEvent = z.infer<typeof projectEventSchema>;
export type ProjectEventsSnapshot = z.infer<typeof projectEventsSnapshotSchema>;
export type GithubProjectRepo = z.infer<typeof githubProjectRepoSchema>;
export type GithubReleaseNode = z.infer<typeof githubReleaseNodeSchema>;
export type GithubMergedPull = z.infer<typeof githubMergedPullSchema>;

/** The `/v1/project-events` response. */
export const projectEventsEnvelopeSchema = envelopeSchema(
  z.literal('project-events'),
  projectEventsSnapshotSchema
);
