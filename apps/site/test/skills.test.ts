import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  creditParts,
  evalLine,
  installPattern,
  needsNode,
  postsMentioning,
  shelvesOf,
  skillsTagPath,
} from '../src/lib/skills.ts';
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
  eval: {
    passed: 2,
    total: 3,
    threshold: 0.8,
    date: '2026-10-11',
    model: 'claude-sonnet-5-5',
    version: '0.1.1',
  },
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

describe('skills.json values', () => {
  const [first] = committed.skills;
  const issues = (skill: unknown) =>
    skillsSchema.safeParse({ ...committed, skills: [skill] }).error?.issues.map((i) => i.message);

  // Catches a private model alias, path or version string reaching the eval line on the page.
  it('rejects an eval model that is not a public id, and a version that is not SemVer', () => {
    for (const model of ['/tmp/private/trace.jsonl', 'C:\\Users\\x\\notes', 'private-host.corp']) {
      expect(issues({ ...first, eval: { ...first.eval, model } })).toEqual([
        'must be a public model id',
      ]);
    }
    expect(issues({ ...first, eval: { ...first.eval, version: '/srv/x/y' } })).toEqual([
      'must be a SemVer version',
    ]);
  });

  it('rejects a local path of any kind in shown text, and keeps ordinary slashes', () => {
    for (const summary of ['See /srv/app/data.', 'At C:\\Work\\notes.']) {
      expect(issues({ ...first, summary })).toEqual(['must not hold a local path']);
    }
    expect(
      issues({ ...first, summary: 'Read and/or write 3/3 files (https://example.com/a/b).' })
    ).toBeUndefined();
  });
});

describe('eval summary', () => {
  // The compact mark must agree with the sentence in the detail.
  it('is a ratio, with the same counts in words and a flag for a clean run', () => {
    const line = evalLine(skill());
    expect(line?.ratio).toBe('2/3');
    expect(line?.clean).toBe(false);
    expect(line?.cases).toBe('2 of 3 cases passed');
    expect(line?.passMark).toBe('pass mark 80%');
    expect(
      evalLine(
        skill({
          eval: {
            passed: 3,
            total: 3,
            threshold: 0.8,
            date: '2026-10-11',
            model: 'claude-sonnet-5-5',
            version: '0.1.2',
          },
        })
      )?.clean
    ).toBe(true);
  });

  // Catches a result for an older release being read as a result for the current one.
  it('says when the run was against an older version, and is absent without a result', () => {
    expect(evalLine(skill())?.ran).toBe('2026-10-11, claude-sonnet-5-5, skill 0.1.1 (now 0.1.2)');
    expect(evalLine(skill({ eval: null }))).toBeNull();
  });
});

describe('shelves', () => {
  // A new skill from the sync that no shelf names must still show, and this test says to place it.
  it('place every committed skill on a named shelf, once', () => {
    const shelves = shelvesOf(committed.skills);
    expect(shelves.map((shelf) => shelf.title)).not.toContain('More');
    expect(shelves.flatMap((shelf) => shelf.skills.map((entry) => entry.name)).sort()).toEqual(
      committed.skills.map((entry: Skill) => entry.name).sort()
    );
  });

  it('put a skill no shelf names on a last shelf instead of dropping it', () => {
    const shelves = shelvesOf([skill(), skill({ name: 'brand-new' })]);
    expect(shelves.map((shelf) => [shelf.title, shelf.skills.map((entry) => entry.name)])).toEqual([
      ['Delegate and ship', ['commit']],
      ['More', ['brand-new']],
    ]);
  });
});

describe('install line', () => {
  it('leaves the skill and the agent open', () => {
    const install = 'npx skills add ayagmar/agents-skills --skill commit --agent pi';
    expect(installPattern([skill({ install })])).toBe(
      'npx skills add ayagmar/agents-skills --skill <name> --agent <agent>'
    );
    expect(installPattern([skill()])).toBeNull();
  });
});

describe('runtime', () => {
  it('needs Node only when the runtime says so', () => {
    expect(needsNode(skill())).toBe(false);
    expect(needsNode(skill({ runtime: 'Node.js >= 22.19, rg optional' }))).toBe(true);
    expect(needsNode(skill({ runtime: null }))).toBe(false);
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
