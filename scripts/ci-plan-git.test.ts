// The planner's view of a real pull request: a temporary git repository whose HEAD is the
// change on top of its base, read by the `plan` command exactly as CI runs it.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

const planner = join(import.meta.dirname, 'ci.ts');
let repo: string;
const env = () => ({
  PATH: process.env.PATH ?? '',
  HOME: repo,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'test',
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'test',
  GIT_COMMITTER_EMAIL: 'test@example.invalid',
});
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, env: env() });
const write = (path: string, text = 'x\n') => {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), text);
};

/** Commits `change` on top of a base commit and returns the jobs the planner runs. */
function planFor(change: () => void): Record<string, boolean> {
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  change();
  git('add', '-A');
  git('commit', '-q', '-m', 'change');
  const out = execFileSync(process.execPath, [planner, 'plan'], {
    cwd: repo,
    env: { ...env(), GITHUB_EVENT_NAME: 'pull_request' },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return JSON.parse(out.replace(/^plan=/, ''));
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'min7-ci-plan-'));
  git('init', '-q', '-b', 'main');
  git('config', 'core.quotePath', 'true');
  write('README.md');
  write(
    'apps/site/src/pages/a.astro',
    '---\n---\n<p>A page with enough text to be a rename.</p>\n'
  );
});
afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('plan on a real git diff', () => {
  it('reads paths git would quote, such as non-ASCII file names', () => {
    const jobs = planFor(() => write('apps/signals/src/é.ts', 'const x: string = 42;\n'));
    assert.equal(jobs.checks, true);
    assert.equal(jobs['signals-test'], true);
  });

  it('checks the unit a file was renamed out of, not only where it went', () => {
    const jobs = planFor(() => git('mv', 'apps/site/src/pages/a.astro', 'docs-a.astro'));
    assert.equal(jobs['site-build'], true);
    assert.equal(jobs.links, true);
  });
});
