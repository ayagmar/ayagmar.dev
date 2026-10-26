import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { creditParts, evalLine, postsMentioning, skillsTagPath } from '../src/lib/skills.ts';
import { type Skill, skillsSchema } from '../src/lib/skills-schema.ts';
import type { Post } from '../src/lib/writing.ts';

const committed = JSON.parse(
  readFileSync(join(import.meta.dirname, '../../../content/skills.json'), 'utf8')
);

const skill = (overrides: Partial<Skill> = {}): Skill => ({
  name: 'commit',
  summary: 'Create Conventional Commits safely.',
  version: '0.1.2',
  package: '@ayagmar/commit',
  license: 'MIT',
  runtime: 'Instruction-only',
  install: null,
  credit: null,
  readme: 'https://github.com/ayagmar/agents-skills/blob/main/plugins/commit/README.md',
  npm: 'https://www.npmjs.com/package/@ayagmar/commit',
  eval: { passed: 2, total: 3, threshold: 0.8, date: '2026-10-11', model: 'm', version: '0.1.1' },
  ...overrides,
});

const post = (id: string, tags: string[]): Post => ({
  id,
  data: { title: id, date: new Date('2026-10-01'), summary: id, tags, draft: false, projects: [] },
});

describe('skills.json schema', () => {
  it('accepts the committed file', () => {
    expect(skillsSchema.safeParse(committed).error).toBeUndefined();
  });

  // Catches a field added to the sync script reaching the site without a decision about it.
  it('rejects a field outside the allowlist, a repeated skill and a pass count over the total', () => {
    const [first] = committed.skills;
    const messages = (data: unknown) =>
      skillsSchema.safeParse(data).error?.issues.map((issue) => issue.message);
    expect(messages({ ...committed, skills: [{ ...first, costUsd: 0.3 }] })).toEqual([
      expect.stringMatching(/unrecognized/i),
    ]);
    expect(messages({ ...committed, skills: [first, first] })).toEqual(['must not repeat a skill']);
    expect(
      messages({ ...committed, skills: [{ ...first, eval: { ...first.eval, passed: 9 } }] })
    ).toEqual(['must not exceed total']);
  });
});

describe('eval summary', () => {
  // The row of marks must agree with the sentence beside it.
  it('has one mark per case, the passed ones first, and says how many passed', () => {
    const line = evalLine(skill());
    expect(line?.marks).toEqual([true, true, false]);
    expect(line?.cases).toBe('2 of 3 cases passed');
    expect(line?.passMark).toBe('pass mark 80%');
  });

  // Catches a result for an older release being read as a result for the current one.
  it('says when the run was against an older version, and is absent without a result', () => {
    expect(evalLine(skill())?.ran).toBe('2026-10-11, m, skill 0.1.1 (now 0.1.2)');
    expect(evalLine(skill({ eval: null }))).toBeNull();
  });
});

describe('credit lines', () => {
  it('link the web addresses and keep the rest as text', () => {
    expect(
      creditParts('Based on commit from https://github.com/mitsuhiko/agent-stuff (Apache-2.0).')
    ).toEqual([
      { text: 'Based on commit from ' },
      {
        text: 'https://github.com/mitsuhiko/agent-stuff',
        href: 'https://github.com/mitsuhiko/agent-stuff',
      },
      { text: ' (Apache-2.0).' },
    ]);
  });
});

describe('writing about skills', () => {
  const posts = [post('a', ['skills', 'commit']), post('b', ['skills']), post('c', ['rust'])];

  it("lists the posts tagged with a skill's name", () => {
    expect(postsMentioning(posts, skill()).map((entry) => entry.id)).toEqual(['a']);
  });

  // Catches a link to a tag page that was never built.
  it('links the skills tag page only when a published post has the tag', () => {
    expect(skillsTagPath(posts)).toBe('/writing/tags/skills');
    expect(skillsTagPath([post('c', ['rust'])])).toBeNull();
  });
});
