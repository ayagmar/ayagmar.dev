import { z } from 'zod';
import { envelopeSchema, timestampSchema } from '../envelope.ts';
import { npmPackageNameSchema, projectSlugSchema, repoFullNameSchema } from '../projects.ts';
import { githubUrlSchema } from './shipping.ts';

// Wire input: GitHub REST and npm downloads API JSON. Only the fields the normalizer reads
// are declared; zod drops every other key.

/** `GET /repos/{owner}/{repo}`. A renamed repository answers with its new `full_name`. */
export const githubRepoSchema = z.object({
  name: z.string().min(1).max(100),
  full_name: repoFullNameSchema,
  html_url: githubUrlSchema,
  description: z.string().max(1024).nullable(),
  language: z.string().max(100).nullable(),
  stargazers_count: z.number().int().nonnegative(),
  archived: z.boolean(),
  private: z.boolean(),
});

/** `GET /repos/{owner}/{repo}/releases/latest`; 404 when the repository has no release. */
export const githubReleaseSchema = z.object({
  tag_name: z.string().min(1).max(200),
  html_url: githubUrlSchema,
  published_at: timestampSchema.nullable(),
});

/** `GET https://api.npmjs.org/downloads/point/last-month/{package}`. */
export const npmDownloadsSchema = z.object({
  downloads: z.number().int().nonnegative(),
  package: npmPackageNameSchema,
});

// Normalized output: what `/v1/projects` serves.

export const projectSchema = z.object({
  /** The project's slug from `featuredProjects`; posts link to projects by it. */
  slug: projectSlugSchema,
  /** `owner/name` as GitHub reports it now (after a rename). */
  repo: repoFullNameSchema,
  name: z.string().min(1),
  url: githubUrlSchema,
  description: z.string().nullable(),
  language: z.string().nullable(),
  /** null when GitHub did not answer for this repository. */
  stars: z.number().int().nonnegative().nullable(),
  archived: z.boolean().nullable(),
  /** null when there is no published release or GitHub did not answer. */
  latestRelease: z
    .object({ tag: z.string().min(1), url: githubUrlSchema, publishedAt: timestampSchema })
    .nullable(),
  /** null when the project is not published on npm. */
  npm: z
    .object({
      package: npmPackageNameSchema,
      /** Downloads over the last 30 days; null when npm did not answer or knows no such package. */
      monthlyDownloads: z.number().int().nonnegative().nullable(),
    })
    .nullable(),
});

export const projectsSnapshotSchema = z.object({
  /** Featured projects in the order the owner listed them. */
  projects: z.array(projectSchema).max(30),
});

export type Project = z.infer<typeof projectSchema>;
export type ProjectsSnapshot = z.infer<typeof projectsSnapshotSchema>;

/** The `/v1/projects` response. */
export const projectsEnvelopeSchema = envelopeSchema(z.literal('projects'), projectsSnapshotSchema);
