// The Lighthouse job's decisions: which head values fail their budget, which count as a
// regression rather than noise, and how runs and pages are chosen. Lighthouse itself runs in CI.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { medians, overBudget, pagePaths, readLhr, regressions } from './lighthouse.ts';

const values = (over: Partial<Record<string, number>> = {}) => ({
  performance: 1,
  accessibility: 1,
  bestPractices: 1,
  lcp: 900,
  tbt: 0,
  cls: 0,
  ...over,
});

describe('budgets', () => {
  it('fails each metric past its limit for the profile, scores as minimums', () => {
    assert.deepEqual(overBudget(values({ lcp: 2000, cls: 0.01, performance: 0.95 }), 'mobile'), []);
    assert.deepEqual(overBudget(values({ lcp: 2001 }), 'mobile'), ['lcp']);
    assert.deepEqual(overBudget(values({ lcp: 1001 }), 'desktop'), ['lcp']);
    assert.deepEqual(overBudget(values({ accessibility: 0.99, tbt: 101 }), 'desktop'), [
      'accessibility',
      'tbt',
    ]);
  });

  it('counts a regression only past both the ratio and the delta', () => {
    const base = values({ lcp: 1000, tbt: 40 });
    assert.deepEqual(regressions(values({ lcp: 1101, tbt: 40 }), base), ['lcp']);
    // +10 % but only +60 ms; +200 ms but only +5 %.
    assert.deepEqual(regressions(values({ lcp: 660 }), values({ lcp: 600 })), []);
    assert.deepEqual(regressions(values({ lcp: 4200 }), values({ lcp: 4000 })), []);
    assert.deepEqual(regressions(values({ tbt: 100 }), base), ['tbt']);
    assert.deepEqual(regressions(values({ lcp: 9000 }), null), []);
  });
});

describe('runs and pages', () => {
  it('takes the median of each metric on its own', () => {
    const runs = [
      values({ lcp: 900, tbt: 30 }),
      values({ lcp: 1500, tbt: 0 }),
      values({ lcp: 1000, tbt: 10 }),
    ];
    assert.deepEqual(medians(runs), values({ lcp: 1000, tbt: 10 }));
  });

  it('reads a page Lighthouse could not load (a 404 on the base) as not measured', () => {
    const lhr = {
      requestedUrl: 'http://x/',
      runtimeError: { code: 'ERRORED_DOCUMENT_REQUEST' },
      categories: {},
      audits: {},
    };
    assert.equal(readLhr(lhr), null);
    const { runtimeError: _, ...loaded } = lhr;
    assert.throws(() => readLhr(loaded), /no performance in the result/);
  });

  it('measures the largest post and project page, so a heavy one cannot hide behind a light one', () => {
    const dist = mkdtempSync(join(tmpdir(), 'min7-lighthouse-'));
    try {
      mkdirSync(join(dist, 'writing/tags'), { recursive: true });
      writeFileSync(join(dist, 'writing/short.html'), 'x');
      writeFileSync(join(dist, 'writing/long.html'), 'x'.repeat(100));
      writeFileSync(join(dist, 'writing/tags/ci.html'), 'x'.repeat(1000));
      mkdirSync(join(dist, 'projects'));
      writeFileSync(join(dist, 'projects/a.html'), 'x'.repeat(10));
      writeFileSync(join(dist, 'projects/b.html'), 'x'.repeat(10));
      assert.equal(pagePaths(dist).post, '/writing/long');
      // Equal sizes: the first by name, so base and head pick the same page.
      assert.equal(pagePaths(dist).project, '/projects/a');
    } finally {
      rmSync(dist, { recursive: true, force: true });
    }
  });
});
