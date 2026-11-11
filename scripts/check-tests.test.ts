import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { checkTestSource, checkTests } from './check-tests.ts';

const findings = (source: string) =>
  checkTestSource('fixture.test.ts', source).map(({ line, message }) => `${line}: ${message}`);

const presenceOnly =
  'test asserts only presence (toBeDefined, toBeTruthy, not.toBeNull, assert.ok) or mock calls';

describe('check-tests', () => {
  // Catches a test that passes whatever the code does: no assertion, a dangling `expect(x)`,
  // only mock calls, or only a presence check (`not.toBeFalsy()` is `toBeTruthy()`), a focused
  // or silently skipped test, and a node:test todo, which runs but whose failure exits 0.
  it('flags each kind of test that cannot fail or hides others', () => {
    const source = [
      "it('renders', () => { render(); });",
      "it('dangles', () => { expect(render()); });",
      "it('calls', () => { expect(fetch).toHaveBeenCalledWith('/a'); });",
      "it('counts', () => { assert.equal(fn.mock.calls.length, 1); });",
      "it('exists', () => { expect(a).toBeDefined(); expect(b).not.toBeNull(); });",
      "it.only('one', () => { expect(a).toBe(1); });",
      "test.describe.only('suite', () => {});",
      "it('focus', { only: true }, () => { assert.equal(a, 1); });",
      "it.skip('later', () => { expect(a).toBe(1); });",
      "describe.skip('suite', () => {});",
      "test('inside', () => { test.skip(); expect(a).toBe(1); });",
      "it('opt', { skip: true }, () => { assert.equal(a, 1); });",
      "it.todo('later', () => { assert.equal(a, 1); });",
      "it('opt todo', { todo: true }, () => { assert.equal(a, 1); });",
      "it('falsy', () => { expect(a).not.toBeFalsy(); });",
      '// check-tests: allow',
      "it('no reason given', () => {});",
    ].join('\n');
    assert.deepEqual(findings(source), [
      '1: test has no assertion',
      '2: test has no assertion',
      '3: test asserts only that a mock was called',
      '4: test asserts only that a mock was called',
      `5: ${presenceOnly}`,
      '6: focused test (.only) runs only this test',
      '7: focused test (.only) runs only this test',
      '8: focused test (.only) runs only this test',
      '9: skipped without a reason or condition',
      '10: skipped without a reason or condition',
      '11: skipped without a reason or condition',
      '12: skipped without a reason (skip: true)',
      '13: marked todo without a reason, so its failures are ignored',
      '14: marked todo without a reason, so its failures are ignored (todo: true)',
      `15: ${presenceOnly}`,
      '17: test has no assertion',
    ]);
  });

  // Catches the node:test spelling of `toBeTruthy()`, and a weak or mock-only assertion hidden
  // in a helper, getting past the rules the plain form fails.
  it('sees presence checks through assert.ok and helpers', () => {
    const source = [
      "it('ok', () => { assert.ok(result); });",
      "it('bare', () => { assert(result.rows[0]); });",
      "it('context', (t) => { t.assert.ok(result.id); });",
      'const called = () => expect(fn).toHaveBeenCalled();',
      "it('wrapped mock', () => { called(); });",
      'function present(x) { expect(x).toBeTruthy(); }',
      'const viaTwo = (x) => present(x);',
      "it('wrapped presence', () => { viaTwo(a); });",
      'function both(x) { expect(fn).toHaveBeenCalled(); assert.equal(x, 1); }',
      "it('wrapped value', () => { both(a); });",
      "it('predicate', () => { assert.ok(jobs.includes('e2e')); });",
    ].join('\n');
    assert.deepEqual(findings(source), [
      `1: ${presenceOnly}`,
      `2: ${presenceOnly}`,
      `3: ${presenceOnly}`,
      '5: test asserts only that a mock was called',
      `8: ${presenceOnly}`,
    ]);
  });

  // Catches the check failing real tests that assert through helpers, test contexts, tables
  // and conditional skips, which would push people to the escape comment.
  it('accepts the ways this repo asserts and skips', () => {
    const source = [
      "it('matcher', async () => { await expect(page).toHaveTitle('x'); });",
      "it('soft', () => { expect.soft(a, 'why').not.toBe(1); });",
      "it('helper', async () => { await expectNoAxeViolations(page); });",
      'function inner(x) { assert.equal(x, 1); }',
      'const outer = (x) => inner(x);',
      "it('local', () => { outer(1); });",
      "it('context', (t) => { t.assert.deepEqual(a, b); });",
      "it.each([[1]])('row %s', (n) => { expect(n).toBeGreaterThan(0); });",
      "it.skipIf(slow)('fast', () => { expect(a).toEqual(b); });",
      "it('mixed', () => { expect(a).toBeDefined(); expect(a.id).toBe('x'); });",
      "it('mock and value', () => { expect(fn).toHaveBeenCalled(); expect(out).toBe(2); });",
      "test.skip(notes.length === 0, 'content/til has no notes');",
      "test('inside', () => { test.skip(!ready, 'needs ready'); expect(a).toBe(1); });",
      "it('opt', { skip: process.platform !== 'linux' }, () => { assert.equal(a, 1); });",
      "it('opt todo', { todo: 'flaky on CI, #12' }, () => { assert.equal(a, 1); });",
      '// check-tests: allow the smoke run is the assertion',
      "it('runs', () => { main(); });",
      "it.todo('later');",
    ].join('\n');
    assert.deepEqual(findings(source), []);
  });

  // Catches a test file an agent wrote but has not staged passing `just check` locally.
  it('reads untracked test files, not ignored ones', () => {
    const root = mkdtempSync(join(tmpdir(), 'min7-check-tests-'));
    try {
      execFileSync('git', ['init', '-q'], { cwd: root });
      writeFileSync(join(root, '.gitignore'), 'ignored.test.ts\n');
      writeFileSync(join(root, 'new.test.ts'), "it('x', () => {});\n");
      writeFileSync(join(root, 'ignored.test.ts'), "it('x', () => {});\n");
      assert.deepEqual(checkTests(root), ['new.test.ts:1: test has no assertion']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
