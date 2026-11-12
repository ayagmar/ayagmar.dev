// The Lighthouse job's decisions: which head values fail their budget, which count as a
// regression rather than noise, and how runs and pages are chosen. Lighthouse itself runs in CI.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { budgets } from './budgets.ts';
import {
  acceptedChanges,
  acknowledge,
  decide,
  type Metric,
  measuringTools,
  medians,
  overBudget,
  pagePaths,
  readLhr,
  regressions,
  shard,
  shifts,
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

  // Mobile /stats on CI, the same page each time: 75, 83, 106, 109, 101 and 113 ms.
  const overTbt = { over: ['tbt'] as Metric[], regressed: [] as Metric[] };
  const tbtRuns = (tbt: number[]) => ({ base: [], head: tbt.map((t) => values({ tbt: t })) });

  it('passes a TBT budget miss of 113 ms that a re-measure of head reads at about 80 ms', () => {
    assert.deepEqual(decide(overTbt, tbtRuns([75, 83, 80]), 'mobile'), { over: [], regressed: [] });
    // One more miss among the three is still noise: the median decides.
    assert.deepEqual(decide(overTbt, tbtRuns([113, 83, 75]), 'mobile').over, []);
  });

  it('still fails a real 300 ms of TBT, and keeps every other budget miss as first read', () => {
    assert.deepEqual(decide(overTbt, tbtRuns([300, 310, 295]), 'mobile').over, ['tbt']);
    const first = { over: ['lcp', 'tbt'] as Metric[], regressed: [] as Metric[] };
    assert.deepEqual(decide(first, tbtRuns([80, 80, 80]), 'mobile').over, ['lcp']);
  });
});

describe('accepted changes', () => {
  // ADR 0049's case: desktop LCP on the project page CI measures, about 278 ms of text before
  // and 453 ms of screenshot after, re-measured in CI at 426 to 481 ms.
  const entry = {
    page: 'project',
    profile: 'desktop' as const,
    metric: 'lcp' as const,
    base: 278,
    ceiling: 600,
    reason: 'the largest paint is now the project screenshot, not text',
    adr: '0049',
  };
  /** A page whose LCP regressed from `base` to `head`, decided on numbers measured again. */
  const row = (page: string, base: number, head: number, remeasured = true) => ({
    page,
    regressed: ['lcp'] as Metric[],
    base: values({ lcp: base - 20 }),
    remeasured: remeasured ? { base: values({ lcp: base }), head: values({ lcp: head }) } : null,
  });

  // Catches an accepted change that still fails the job, or passes without saying so in the log.
  it('passes the accepted regression on its page and profile, and says so with both numbers', () => {
    assert.deepEqual(acknowledge(row('project', 278, 453), 'desktop', [entry]), {
      regressed: [],
      notes: [
        'project (desktop) lcp: accepted a regression from 278 to 453 ms (re-measured, ceiling 600 ms): the largest paint is now the project screenshot, not text (ADR 0049)',
      ],
    });
    // A base that reads a round trip off the recorded one is the same base.
    assert.deepEqual(acknowledge(row('project', 318, 468), 'desktop', [entry]).regressed, []);
  });

  // Catches an entry that turns into a pass for any LCP on the page, or one excusing first
  // numbers the re-measure never confirmed.
  it('still fails the same page over the ceiling, or decided on first numbers only', () => {
    const over = acknowledge(row('project', 278, 650), 'desktop', [entry]);
    assert.deepEqual(over.regressed, ['lcp']);
    assert.match(over.notes[0] ?? '', /650 ms is over the 600 ms accepted in ADR 0049/);
    assert.deepEqual(acknowledge(row('project', 278, 453, false), 'desktop', [entry]), {
      regressed: ['lcp'],
      notes: [],
    });
  });

  // Catches an entry that matches on profile or metric alone and excuses other pages.
  it('still fails another page, or the same page on mobile, with the same numbers', () => {
    assert.deepEqual(acknowledge(row('projects', 278, 453), 'desktop', [entry]).regressed, ['lcp']);
    // 278 to 500 ms is past mobile's 200 ms allowance.
    assert.deepEqual(acknowledge(row('project', 278, 500), 'mobile', [entry]), {
      regressed: ['lcp'],
      notes: [],
    });
  });

  // Catches an entry left in budgets.json after main caught up excusing the next regression on
  // the page, which should fail like any other.
  it('excuses nothing once the base has moved off the recorded one, and asks for its removal', () => {
    const later = acknowledge(row('project', 400, 520), 'desktop', [entry]);
    assert.deepEqual(later.regressed, ['lcp']);
    assert.deepEqual(later.notes, [
      'project (desktop) lcp: the accepted change (ADR 0049) is stale: the base reads 400 ms, not about 278 ms; remove it from budgets.json',
    ]);
    // After the merge the base reads the screenshot too: nothing regresses, the note still shows.
    const caughtUp = {
      page: 'project',
      regressed: [],
      base: values({ lcp: 453 }),
      remeasured: null,
    };
    assert.match(acknowledge(caughtUp, 'desktop', [entry]).notes[0] ?? '', /is stale/);
  });

  // Catches a typo in budgets.json that would excuse nothing (an unknown page, a misspelt field)
  // or more than meant (a ceiling past the budget, another metric), found by `just check`
  // rather than on the run that needs it.
  it('refuses a malformed entry, and reads the real one with its ADR on disk', () => {
    const { adr: _, ...noAdr } = entry;
    for (const [bad, message] of [
      [{ ...entry, page: 'projetc' }, /page projetc is not in lighthouse\.pages/],
      [{ ...entry, profile: 'tablet' }, /profile tablet/],
      [{ ...entry, metric: 'tbt' }, /metric tbt: only lcp/],
      [{ ...entry, ceiling: 1200 }, /ceiling 1200 ms is not between the base and the budget/],
      [{ ...entry, ceiling: 278 }, /ceiling 278 ms/],
      [{ ...entry, base: 278.5 }, /whole ms/],
      [{ ...entry, reason: '' }, /reason is one line/],
      [{ ...entry, adr: '49' }, /adr 49/],
      [noAdr, /needs exactly/],
      [{ ...entry, until: '2026-12-01' }, /needs exactly/],
    ] as const) {
      assert.throws(() => acceptedChanges([bad]), message);
    }
    assert.throws(() => acceptedChanges([entry, entry]), /project desktop lcp is accepted twice/);
    const adrs = readdirSync(join(import.meta.dirname, '../docs/adr'));
    for (const { adr } of acceptedChanges()) {
      assert.equal(
        adrs.some((file) => file.startsWith(`${adr}-`)),
        true,
        `ADR ${adr} is not in docs/adr`
      );
    }
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

  // Catches a CLS failure on the runner that names nothing, or a crash on a result without the
  // audit, which would hide the real budget failure behind a script error.
  it('names what moved, worst first, and nothing when the audit is missing', () => {
    const item = (score: number, node: object) => ({ score, node });
    const lhr = {
      requestedUrl: 'http://x/stats',
      categories: {},
      audits: {
        'layout-shifts': {
          details: {
            items: [item(0.0479, { selector: 'div.stats-grid' }), item(0.0004, { snippet: '<p>' })],
          },
        },
      },
    };
    assert.deepEqual(shifts(lhr), ['0.0479 div.stats-grid', '0.0004 <p>']);
    assert.deepEqual(shifts({ ...lhr, audits: {} }), []);
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

  // Catches the run failing when every post is a draft: production has no /writing/* page.
  it('leaves out a page kind the build has none of', () => {
    const dist = mkdtempSync(join(tmpdir(), 'min7-lighthouse-'));
    try {
      mkdirSync(join(dist, 'projects'));
      writeFileSync(join(dist, 'projects/a.html'), 'x');
      const paths = pagePaths(dist);
      assert.equal('post' in paths, false);
      assert.equal(paths.project, '/projects/a');
      assert.equal(paths.writing, '/writing');
    } finally {
      rmSync(dist, { recursive: true, force: true });
    }
  });

  // Catches a page in budgets.json that no CI job measures, or that two jobs report.
  it('puts every page in exactly one shard, whichever pages the build left out', () => {
    const all = Object.fromEntries(Object.keys(budgets.lighthouse.pages).map((n) => [n, `/${n}`]));
    const { post: _, ...withoutPost } = all;
    for (const paths of [all, withoutPost]) {
      for (const count of [1, 2, 3, 4]) {
        const names = Array.from({ length: count }, (_, i) =>
          Object.keys(shard(paths, i + 1, count))
        );
        assert.deepEqual(names.flat().sort(), Object.keys(paths).sort());
      }
    }
    // A left-out page does not move the others between shards, so their cached base still applies.
    assert.deepEqual(Object.keys(shard(withoutPost, 3, 3)), Object.keys(shard(all, 3, 3)));
  });
});

describe('measuring tools', () => {
  const installed = {
    '@lhci/cli': ['0.15.1', { lighthouse: '12.6.1' }],
    lighthouse: ['12.6.1', { 'axe-core': '^4', buffer: '^5' }],
    'axe-core': ['4.14.0', {}],
    // An npm package named like a Node core module, as Lighthouse 13 pulls in through bl.
    buffer: ['5.7.1', {}],
    '@playwright/test': ['1.64.1', { 'playwright-core': '1.64.1' }],
    'playwright-core': ['1.64.1', {}],
    wrangler: ['4.156.0', { workerd: '1' }],
    workerd: ['1.20261023.1', {}],
    knip: ['6.44.1', {}],
  } as const;
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'min7-lighthouse-tools-'));
    for (const [name, [version, dependencies]] of Object.entries(installed)) {
      // wrangler sits in the site's own node_modules, as a workspace package's dependency does.
      const dir = join(root, name === 'wrangler' ? 'apps/site' : '', 'node_modules', name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version, dependencies }));
    }
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  /** A pnpm-lock.yaml (an env document, then the main one) for what is installed. */
  const lockfile = (
    change: { integrity?: Record<string, string>; patches?: Record<string, string> } = {}
  ) => {
    const packages = Object.entries(installed).map(
      ([name, [version]]) =>
        `  '${name}@${version}':\n    resolution: {integrity: ${change.integrity?.[name] ?? `sha512-${name}`}}\n`
    );
    const patches = Object.entries(change.patches ?? {}).map(
      ([key, hash]) => `  '${key}': ${hash}\n`
    );
    return [
      "---\nlockfileVersion: '9.0'\npackages:\n  pnpm@12.16.1:\n    resolution: {integrity: sha512-pnpm}\n",
      `---\nlockfileVersion: '9.0'\n${patches.length ? `patchedDependencies:\n${patches.join('')}` : ''}packages:\n${packages.join('')}`,
    ].join('');
  };
  const tools = (lock = lockfile()) => measuringTools(join(root, 'apps/site'), lock);

  // Catches a cached base measured with another axe-core (its accessibility score) or workerd
  // being reused, a bump of an unrelated tool (knip) throwing the cache away, and a dependency
  // named like a Node core module (buffer) reported as not installed.
  it('lists every package the measurement loads, transitive ones included, and nothing else', () => {
    const list = tools();
    assert.ok(list.some((t) => t.startsWith('axe-core@4.14.0 ')));
    assert.ok(list.some((t) => t.startsWith('buffer@5.7.1 ')));
    assert.ok(list.some((t) => t.startsWith('workerd@1.20261023.1 ')));
    assert.ok(!list.some((t) => t.startsWith('knip@')));
    assert.deepEqual(tools(lockfile({ integrity: { knip: 'sha512-other' } })), list);
    rmSync(join(root, 'node_modules/workerd'), { recursive: true });
    assert.throws(() => tools(), /workerd is not installed/);
  });

  // Catches a stale base reused after a same-version change to measuring code: a pnpm patch
  // (by exact version, range or bare name) or a re-published or re-sourced package.
  it('changes when a measuring package is patched or resolves differently at the same version', () => {
    const list = tools();
    for (const patches of [
      { 'axe-core@4.14.0': 'aaa' },
      { 'axe-core@^4': 'aaa' },
      { 'axe-core': 'aaa' },
    ]) {
      const patched = tools(lockfile({ patches }));
      assert.notDeepEqual(patched, list);
      assert.notDeepEqual(
        tools(lockfile({ patches: { [Object.keys(patches)[0] ?? '']: 'bbb' } })),
        patched
      );
    }
    assert.deepEqual(tools(lockfile({ patches: { 'axe-core@4.13.0': 'aaa', knip: 'aaa' } })), list);
    assert.notDeepEqual(tools(lockfile({ integrity: { lighthouse: 'sha512-other' } })), list);
  });

  // Catches a measuring package missing from the lockfile silently dropping out of the key.
  it('fails when a measuring package has no lockfile entry', () => {
    const lock = lockfile().replace(/ {2}'axe-core@4\.14\.0':\n.*\n/, '');
    assert.throws(
      () => tools(lock),
      /axe-core@4\.14\.0 is installed but has no entry in pnpm-lock\.yaml/
    );
  });
});
