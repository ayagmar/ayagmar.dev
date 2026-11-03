import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkTestSource } from './check-tests.ts';

const findings = (source: string) =>
  checkTestSource('fixture.test.ts', source).map(({ line, message }) => `${line}: ${message}`);

describe('check-tests', () => {
  // Catches a test that passes whatever the code does: no assertion, a dangling `expect(x)`,
  // only mock calls, or only a presence check, and a focused or silently skipped test.
  it('flags each kind of test that cannot fail or hides others', () => {
    const source = [
      "it('renders', () => { render(); });",
      "it('dangles', () => { expect(render()); });",
      "it('calls', () => { expect(fetch).toHaveBeenCalledWith('/a'); });",
      "it('counts', () => { assert.equal(fn.mock.calls.length, 1); });",
      "it('exists', () => { expect(a).toBeDefined(); expect(b).not.toBeNull(); });",
      "it.only('one', () => { expect(a).toBe(1); });",
      "test.describe.only('suite', () => {});",
      "it('focus', { only: true }, () => { assert.ok(a); });",
      "it.skip('later', () => { expect(a).toBe(1); });",
      "describe.skip('suite', () => {});",
      "test('inside', () => { test.skip(); expect(a).toBe(1); });",
      "it('opt', { skip: true }, () => { assert.ok(a); });",
      '// check-tests: allow',
      "it('no reason given', () => {});",
    ].join('\n');
    assert.deepEqual(findings(source), [
      '1: test has no assertion',
      '2: test has no assertion',
      '3: test asserts only that a mock was called',
      '4: test asserts only that a mock was called',
      '5: test asserts only toBeDefined/toBeTruthy/not.toBeNull or mock calls',
      '6: focused test (.only) runs only this test',
      '7: focused test (.only) runs only this test',
      '8: focused test (.only) runs only this test',
      '9: skipped without a reason or condition',
      '10: skipped without a reason or condition',
      '11: skipped without a reason or condition',
      '12: skipped without a reason (skip: true)',
      '14: test has no assertion',
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
      "it('opt', { skip: process.platform !== 'linux' }, () => { assert.ok(a); });",
      '// check-tests: allow the smoke run is the assertion',
      "it('runs', () => { main(); });",
      "it.todo('later');",
    ].join('\n');
    assert.deepEqual(findings(source), []);
  });
});
