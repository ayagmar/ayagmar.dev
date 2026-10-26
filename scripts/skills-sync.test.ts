import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { extractSkills, leaks, render } from './skills-sync.ts';

const readme = `# agents-skills

## Skills

| Skill | npm package | Version | Runtime | Purpose |
|---|---|---|---|---|
| [alpha](plugins/alpha/README.md) | \`@ayagmar/alpha\` | [![npm](https://img.shields.io/npm/v/@ayagmar/alpha)](https://www.npmjs.com/package/@ayagmar/alpha) | Instruction-only | Plan things before doing them. |
| [gamma](plugins/gamma/README.md) | \`@ayagmar/gamma\` | badge | Node.js >= 22.19, \`rg\` optional | Search the logs. |

## Install
`;

const aggregate = (overrides: Record<string, unknown> = {}) => ({
  startedAt: '2026-10-11T19:16:44.864Z',
  costUsd: 0.33,
  partial: false,
  suite: {
    root: '/home/someone/projects/agents-skills',
    modelOverride: 'claude-sonnet-5-5',
    judgeModel: 'claude-haiku-5-5',
    threshold: 0.8,
    plugins: [
      {
        name: 'alpha',
        version: '0.1.1',
        path: '/home/someone/projects/agents-skills/plugins/alpha',
      },
    ],
  },
  cases: [
    { name: 'a-case', arms: { with: [{ tracePath: '/tmp/claude-eval-x/out/trace.jsonl' }] } },
  ],
  aggregates: { casesTotal: 3, casesPassed: 2 },
  ...overrides,
});

let root: string;
let counter = 0;

function write(base: string, path: string, content: string) {
  mkdirSync(dirname(join(base, path)), { recursive: true });
  writeFileSync(join(base, path), content);
}

function plugin(base: string, name: string, extra: { frontmatter?: string; readme?: string } = {}) {
  write(
    base,
    `plugins/${name}/package.json`,
    JSON.stringify({
      name: `@ayagmar/${name}`,
      version: '0.2.0',
      description: `The ${name} package description.`,
      license: 'MIT',
    })
  );
  write(
    base,
    `plugins/${name}/skills/${name}/SKILL.md`,
    `---\nname: ${name}\ndescription: "Long trigger text. Use when asked."\n${extra.frontmatter ?? ''}---\n\n# ${name}\n`
  );
  write(
    base,
    `plugins/${name}/README.md`,
    extra.readme ??
      `# ${name}\n\n\`\`\`bash\nnpx skills add ayagmar/agents-skills --skill ${name} --agent pi\n\`\`\`\n`
  );
}

/** A throwaway skills repo with one commit, in its own directory. */
function repo(build: (dir: string) => void): string {
  const dir = join(root, `repo-${counter++}`);
  mkdirSync(dir, { recursive: true });
  build(dir);
  const env = {
    PATH: process.env.PATH,
    HOME: root,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 'test@example.invalid',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 'test@example.invalid',
    GIT_AUTHOR_DATE: '2026-10-20T10:00:00Z',
    GIT_COMMITTER_DATE: '2026-10-20T10:00:00Z',
  };
  for (const args of [
    ['init', '-q'],
    ['add', '.'],
    ['commit', '-q', '-m', 'fixture'],
  ]) {
    execFileSync('git', args, { cwd: dir, env });
  }
  return dir;
}

const standard = () =>
  repo((dir) => {
    write(dir, 'README.md', readme);
    plugin(dir, 'alpha', { frontmatter: 'metadata:\n  sources: "someone/alpha (MIT)"\n' });
    // No row in the README table, no install line, no credit.
    plugin(dir, 'beta', { readme: '# beta\n' });
    plugin(dir, 'gamma', {
      readme: `# gamma\n\n## Credits\n\nBased on [gamma](https://example.com/g) by someone, modified.\n\n## Links\n`,
    });
  });

before(() => {
  root = mkdtempSync(join(tmpdir(), 'min7-skills-sync-'));
});
after(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('skills sync', () => {
  it('copies an allowlist of fields and nothing from the eval results around them', () => {
    const evals = join(root, 'evals-ok');
    write(evals, 'alpha/aggregate-result.json', JSON.stringify(aggregate()));
    const { file } = extractSkills(standard(), evals);
    const [alpha] = file.skills;
    assert.deepEqual(Object.keys(alpha ?? {}), [
      'name',
      'summary',
      'version',
      'package',
      'license',
      'runtime',
      'install',
      'credit',
      'readme',
      'npm',
      'eval',
    ]);
    assert.deepEqual(alpha?.eval, {
      passed: 2,
      total: 3,
      threshold: 0.8,
      date: '2026-10-11',
      model: 'claude-sonnet-5-5',
      version: '0.1.1',
    });
    assert.equal(alpha?.summary, 'Plan things before doing them.');
    assert.equal(alpha?.credit, 'someone/alpha (MIT)');
    assert.equal(alpha?.install, 'npx skills add ayagmar/agents-skills --skill alpha --agent pi');
    assert.equal(file.source.committedAt, '2026-10-20T10:00:00.000Z');
    // The result files hold the machine's paths and the run's cost; none of it may come through.
    const text = render(file);
    for (const secret of ['/home/someone', '/tmp/claude-eval', 'costUsd', 'judgeModel']) {
      assert.ok(!text.includes(secret), `output contains ${secret}`);
    }
  });

  it('lists the README table first, then other plugins', () => {
    const { file } = extractSkills(standard(), null);
    assert.deepEqual(
      file.skills.map((skill) => skill.name),
      ['alpha', 'gamma', 'beta']
    );
  });

  // Catches a skill missing from the README table getting an empty or invented description.
  it('takes the summary from package.json for a skill without a README row, and says so', () => {
    const { file, warnings } = extractSkills(standard(), null);
    const beta = file.skills.find((skill) => skill.name === 'beta');
    assert.equal(beta?.summary, 'The beta package description.');
    assert.equal(beta?.runtime, null);
    assert.equal(beta?.install, null);
    assert.deepEqual(warnings, ['beta: no row in the README table; summary from package.json']);
  });

  it('reads the credit from the README when SKILL.md has no sources, links reduced to text', () => {
    const { file } = extractSkills(standard(), null);
    assert.equal(
      file.skills.find((skill) => skill.name === 'gamma')?.credit,
      'Based on gamma by someone, modified.'
    );
  });

  // Catches a skill that was never evaluated showing a result, or the run failing for it.
  it('has no eval for a skill without results', () => {
    const evals = join(root, 'evals-partial');
    write(evals, 'alpha/aggregate-result.json', JSON.stringify(aggregate()));
    const { file } = extractSkills(standard(), evals);
    assert.deepEqual(
      file.skills.map((skill) => skill.eval !== null),
      [true, false, false]
    );
  });

  // Catches half-read results publishing a wrong pass count.
  for (const [what, data] of [
    ['has no totals', aggregate({ aggregates: {} })],
    ['passes more than it ran', aggregate({ aggregates: { casesTotal: 2, casesPassed: 3 } })],
    ['is for another plugin', aggregate({ suite: { ...aggregate().suite, plugins: [] } })],
  ] as const) {
    it(`fails on a malformed aggregate that ${what}, naming the file`, () => {
      const evals = join(root, `evals-bad-${counter++}`);
      write(evals, 'alpha/aggregate-result.json', JSON.stringify(data));
      assert.throws(() => extractSkills(standard(), evals), /alpha\/aggregate-result\.json/);
    });
  }

  it('leaves out an eval run that was cut short instead of reporting its counts', () => {
    const evals = join(root, 'evals-cut');
    write(evals, 'alpha/aggregate-result.json', JSON.stringify(aggregate({ partial: true })));
    const { file, warnings } = extractSkills(standard(), evals);
    assert.equal(file.skills[0]?.eval, null);
    assert.match(warnings.join('\n'), /alpha: the eval run is partial/);
  });

  it('refuses to produce a file that holds a local path, an address or a secret', () => {
    for (const line of [
      'See /home/someone/notes for more.',
      'Mail someone@example.com to ask.',
      `Token ghp_${'a1B2'.repeat(9)} works.`,
    ]) {
      const dir = repo((base) => {
        write(base, 'README.md', readme.replace('Plan things before doing them.', line));
        plugin(base, 'alpha');
        plugin(base, 'gamma');
      });
      assert.throws(() => extractSkills(dir, null), /the output contains/);
    }
  });
});

describe('skills sync provenance', () => {
  // Catches local edits and unpublished plugins being published under the commit's SHA.
  it('reads the commit, not the working tree', () => {
    const dir = standard();
    write(dir, 'README.md', readme.replace('Plan things before doing them.', 'Edited locally.'));
    write(
      dir,
      'plugins/alpha/package.json',
      JSON.stringify({ name: '@ayagmar/alpha', version: '9.9.9', license: 'MIT' })
    );
    plugin(dir, 'unpublished'); // untracked: never committed
    const { file } = extractSkills(dir, null);
    assert.deepEqual(
      file.skills.map((skill) => skill.name),
      ['alpha', 'gamma', 'beta']
    );
    assert.equal(file.skills[0]?.summary, 'Plan things before doing them.');
    assert.equal(file.skills[0]?.version, '0.2.0');
  });
});

describe('the committed content/skills.json', () => {
  const path = join(import.meta.dirname, '..', 'content', 'skills.json');

  // The file is published as is. The eval results it came from hold absolute paths, costs and
  // transcripts; this fails if any of that, or an address or a token, reaches the commit, or
  // if a field outside the allowlist appears.
  it('holds no local path, address, secret or cost', () => {
    const text = readFileSync(path, 'utf8');
    assert.deepEqual(leaks(text), []);
    const keys = new Set<string>();
    JSON.stringify(JSON.parse(text), (key, value) => {
      if (key !== '' && !/^\d+$/.test(key)) keys.add(key);
      return value;
    });
    assert.deepEqual(
      [...keys].sort(),
      [
        ...['source', 'repo', 'commit', 'committedAt', 'skills'],
        ...['name', 'summary', 'version', 'package', 'license', 'runtime', 'install', 'credit'],
        ...['readme', 'npm', 'eval', 'passed', 'total', 'threshold', 'date', 'model'],
      ].sort()
    );
  });

  it('is what the sync writes: formatted, and ending in a newline', () => {
    const text = readFileSync(path, 'utf8');
    assert.equal(render(JSON.parse(text)), text);
  });
});
