// The Lighthouse job's decisions: which head values fail their budget, which count as a
// regression rather than noise, and how runs and pages are chosen. Lighthouse itself runs in CI.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  decide,
  type Metric,
  medians,
  overBudget,
  pagePaths,
  readLhr,
  regressions,
} from './lighthouse.ts';

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
    assert.deepEqual(regressions(values({ lcp: 1101, tbt: 40 }), base, 'desktop'), ['lcp']);
    // +10 % but only +60 ms; +200 ms but only +5 %.
    assert.deepEqual(regressions(values({ lcp: 660 }), values({ lcp: 600 }), 'desktop'), []);
    assert.deepEqual(regressions(values({ lcp: 4200 }), values({ lcp: 4000 }), 'mobile'), []);
    assert.deepEqual(regressions(values({ tbt: 100 }), base, 'desktop'), ['tbt']);
    assert.deepEqual(regressions(values({ lcp: 9000 }), null, 'mobile'), []);
  });

  it('flags mobile TBT above the 62 ms that unchanged pages read, under the 100 ms budget', () => {
    // #73, which changed no page: home read 0 ms on the base and 56 ms on head.
    assert.deepEqual(regressions(values({ tbt: 56 }), values({ tbt: 0 }), 'mobile'), []);
    // One 30 ms task, four times slower on mobile: about 70 ms of TBT, which desktop reads as 0.
    assert.deepEqual(regressions(values({ tbt: 76 }), values({ tbt: 0 }), 'mobile'), ['tbt']);
    assert.deepEqual(overBudget(values({ tbt: 76 }), 'mobile'), []);
  });

  it('absorbs one simulated mobile round trip, the jump seen between identical builds', () => {
    // CI, same site output: 762 ms and 912 ms medians, one 150 ms RTT apart.
    assert.deepEqual(regressions(values({ lcp: 912 }), values({ lcp: 762 }), 'mobile'), []);
    assert.deepEqual(regressions(values({ lcp: 1063 }), values({ lcp: 762 }), 'mobile'), ['lcp']);
  });
});

describe('measured again', () => {
  // Two local `just lighthouse --profile mobile` runs on 2026-10-31 against a cached base of
  // 600 ms on every page, so every page was measured again: each run's LCP in ms, in the order
  // measured, base and head in turn. TBT was 0 ms in every run. The first compared two copies
  // of one build; the second the same, but with a 300 KB render-blocking script in the head of
  // /projects on head. Unchanged pages' medians land up to a round trip apart (/writing 1,512 →
  // 1,657 ms, home 1,962 → 1,809 ms), never two.
  const identical = {
    home: { base: [1964, 1957, 1962], head: [1809, 1959, 1807] },
    post: { base: [1657, 1657, 1658], head: [1657, 1659, 1514] },
    writing: { base: [1512, 1512, 1657], head: [1656, 1657, 1807] },
    projects: { base: [1363, 1510, 1660], head: [1507, 1512, 1212] },
    project: { base: [1509, 1659, 1512], head: [1509, 1507, 1655] },
    about: { base: [1807, 1511, 1807], head: [1661, 1807, 1513] },
    stats: { base: [1809, 1662, 1807], head: [1660, 1659, 1807] },
    uses: { base: [1811, 1810, 1811], head: [1810, 1811, 1663] },
  };
  const second = {
    home: { base: [1810, 1957, 1808], head: [1809, 1958, 1812] },
    post: { base: [1658, 1657, 1656], head: [1657, 1658, 1659] },
    writing: { base: [1510, 1510, 1511], head: [1512, 1657, 1657] },
    project: { base: [1510, 1656, 1209], head: [1362, 1512, 1365] },
    about: { base: [1510, 1807, 1807], head: [1806, 1808, 1807] },
    stats: { base: [1808, 1511, 1664], head: [1659, 1662, 1658] },
    uses: { base: [1809, 1665, 1661], head: [1664, 1809, 1809] },
  };
  const heavy = { base: [1660, 1361, 1512], head: [2858, 2857, 2858] };
  const runs = (lcps: number[]) => lcps.map((lcp) => values({ lcp }));
  const suspect = { over: [] as Metric[], regressed: ['lcp'] as Metric[] };

  it('never fails an unchanged page on the runs Lighthouse recorded for it, 15 times over', () => {
    const recorded = [...Object.entries(identical), ...Object.entries(second)];
    assert.equal(recorded.length, 15);
    for (const [page, lcp] of recorded) {
      const measured = { base: runs(lcp.base), head: runs(lcp.head) };
      assert.deepEqual(decide(suspect, measured, 'mobile').regressed, [], page);
    }
  });

  it('still fails a 300 KB render-blocking script on the runs recorded for it', () => {
    const measured = { base: runs(heavy.base), head: runs(heavy.head) };
    assert.deepEqual(decide(suspect, measured, 'mobile').regressed, ['lcp']);
  });

  // #52 read 0.0102 on desktop /writing against the 0.01 budget; the other 117 desktop medians
  // of /writing in CI read 0.0015 or 0.0016.
  const overCls = { over: ['cls'] as Metric[], regressed: [] as Metric[] };
  const clsRuns = (cls: number[]) => ({ base: [], head: cls.map((c) => values({ cls: c })) });

  it('passes a CLS budget miss that a clean re-measure of head does not repeat', () => {
    assert.deepEqual(decide(overCls, clsRuns([0.0015, 0.0016, 0.0015]), 'desktop'), {
      over: [],
      regressed: [],
    });
    // One more 0.0102 among the three is still noise: the median decides.
    assert.deepEqual(decide(overCls, clsRuns([0.0102, 0.0016, 0.0015]), 'desktop').over, []);
  });

  it('still fails a real CLS shift of 0.05, and keeps every other budget miss as first read', () => {
    const shifted = clsRuns([0.0515, 0.0516, 0.0515]);
    assert.deepEqual(decide(overCls, shifted, 'desktop').over, ['cls']);
    const first = { over: ['lcp', 'cls'] as Metric[], regressed: ['lcp'] as Metric[] };
    // Head alone measured again: the regression is not decided again, and LCP's budget stays.
    assert.deepEqual(decide(first, clsRuns([0.0015, 0.0015, 0.0015]), 'desktop'), {
      over: ['lcp'],
      regressed: ['lcp'],
    });
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
