import { z } from 'astro/zod';

const text = z.string({ error: 'is required' }).trim().min(1, 'must not be empty');
const url = z.url({ protocol: /^https$/, error: 'must be an https:// URL' });
const count = z.number().int('must be a whole number').min(0);

const evaluation = z
  .strictObject({
    passed: count,
    total: count.min(1),
    /** Share of a case's runs that must pass, 0 to 1. */
    threshold: z.number().gt(0).max(1),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a day like 2026-10-11'),
    model: text,
    /** The skill version the suite ran against, which may be older than the skill's. */
    version: text,
  })
  .refine((result) => result.passed <= result.total, {
    path: ['passed'],
    message: 'must not exceed total',
  });

/** One skill, as `just skills-sync` extracts it from the skills repo. */
const skill = z.strictObject({
  name: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be a lowercase skill name'),
  summary: text,
  version: text,
  package: text,
  license: text,
  runtime: text.nullable(),
  install: text.nullable(),
  credit: text.nullable(),
  readme: url,
  npm: url,
  eval: evaluation.nullable(),
});

/**
 * content/skills.json: the public skills repo's skills at one commit. Unknown fields are
 * rejected so a new field in the sync script cannot reach a page unreviewed (ADR 0031).
 */
export const skillsSchema = z.strictObject({
  source: z.strictObject({
    repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/, 'must be owner/name'),
    commit: z.string().regex(/^[0-9a-f]{40}$/, 'must be a full commit SHA'),
    committedAt: z.iso.datetime({ error: 'must be an ISO date and time' }),
  }),
  skills: z
    .array(skill)
    .min(1, 'must list at least one skill')
    .refine((skills) => new Set(skills.map((entry) => entry.name)).size === skills.length, {
      message: 'must not repeat a skill',
    }),
});

export type Skill = z.output<typeof skill>;
export type SkillsFile = z.output<typeof skillsSchema>;
