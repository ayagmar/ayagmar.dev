import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { check } from './ci-policy.ts';

const justfile = `
w := "pnpm exec wrangler"

typegen:
    {{ w }} types
build: typegen
    {{ w }} deploy --dry-run --outdir dist
deploy: build
    {{ w }} deploy
release: deploy
`;

let root: string;
const workflow = (steps: string) => {
  writeFileSync(join(root, '.github/workflows/ci.yml'), `jobs:\n  a:\n    steps:\n${steps}`);
  return check(root);
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'min7-ci-policy-'));
  mkdirSync(join(root, '.github/workflows'), { recursive: true });
  writeFileSync(join(root, 'justfile'), justfile);
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('ci-policy', () => {
  it('allows recipes that only run offline Wrangler commands', () => {
    assert.deepEqual(workflow('      - run: just build\n'), []);
  });

  it('fails when a workflow reaches a deploy through a recipe dependency', () => {
    const problems = workflow('      - run: just release\n');
    assert.equal(problems.length, 1);
    assert.match(
      problems[0] ?? '',
      /^just deploy \(run by just release in \.github\) calls Wrangler online/
    );
  });

  it('fails when a workflow calls Wrangler or sets a Cloudflare token itself', () => {
    const problems = workflow(
      '      - run: pnpm exec wrangler deploy\n        env:\n          CLOUDFLARE_API_TOKEN: x\n'
    );
    assert.deepEqual(problems, [
      '.github/workflows/ci.yml:4: calls Wrangler directly',
      '.github/workflows/ci.yml:6: names a Cloudflare credential or action',
    ]);
  });

  it('fails on a recipe the justfile does not define', () => {
    assert.equal(workflow('      - run: just missing\n').length, 1);
  });
});
