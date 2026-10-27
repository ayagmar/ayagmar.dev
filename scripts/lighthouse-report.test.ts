// The Lighthouse comment path: the artifact validator and renderer against valid, oversized
// and hostile artifacts, the copy of them that ci.yml runs, the comment job's isolation, and
// its post-or-update step run for real against a stand-in `gh`.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { parse } from 'yaml';
import { budgets } from './budgets.ts';
import { embedded } from './lighthouse-embed.ts';
import { marker, maxBytes, merge, metrics, pages, render, validate } from './lighthouse-report.js';

const root = join(import.meta.dirname, '..');
const report = join(import.meta.dirname, 'lighthouse-report.js');
const workflowText = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');

const values = (over: Partial<Record<string, number>> = {}) => ({
  performance: 0.99,
  accessibility: 1,
  bestPractices: 0.96,
  lcp: 1450,
  tbt: 20,
  cls: 0.002,
  ...over,
});
const artifact = () => ({
  version: 1,
  runs: 3,
  results: [
    { page: 'home', profile: 'mobile', head: values(), base: values(), over: [], regressed: [] },
    {
      page: 'post',
      profile: 'mobile',
      head: values({ lcp: 2300 }),
      base: values({ lcp: 1500 }),
      over: ['lcp'],
      regressed: ['lcp'],
    },
    {
      page: 'stats',
      profile: 'desktop',
      head: values({ lcp: 400 }),
      base: null,
      over: [],
      regressed: [],
    },
  ],
});
type Artifact = ReturnType<typeof artifact> & Record<string, unknown>;
const text = (change: (a: Artifact) => void = () => {}) => {
  const a = artifact() as Artifact;
  change(a);
  return JSON.stringify(a);
};
const injection = '<img src=x onerror=alert(1)> | **x** <!-- min7-lighthouse -->';

describe('validate and render', () => {
  it('renders base → head per page and profile, marking budget failures and regressions', () => {
    const body = render(validate(text()));
    assert.ok(body.startsWith(`${marker}\n`));
    assert.match(body, /1 page and profile combination fails/);
    assert.match(body, /### Mobile[\s\S]*\| A post \| 99 → 99 \| .* \| 1\.50 s → 2\.30 s ✗ ▲ \|/);
    assert.match(body, /### Desktop[\s\S]*\| Stats \| new → 99 \|/);
    assert.ok(body.indexOf('| Home |') < body.indexOf('| A post |'));
  });

  it('says so when everything passes', () => {
    const body = render(validate(text((a) => a.results.splice(1, 1))));
    assert.match(body, /Every page is within budget and no metric regressed\./);
    assert.doesNotMatch(body, /✗|▲/);
  });

  it('marks a profile with no artifact as incomplete instead of giving the all-clear', () => {
    const mobileOnly = text((a) => {
      a.results = a.results.filter((r) => r.profile === 'mobile' && r.over.length === 0);
    });
    const body = render(validate(mobileOnly));
    assert.match(body, /Incomplete: no metrics from the desktop job/);
    assert.doesNotMatch(body, /Every page is within budget/);
    assert.doesNotMatch(body, /### Desktop/);
    // Both problems are told, and the budget failure is still counted.
    const failing = render(validate(text((a) => a.results.splice(2, 1))));
    assert.match(failing, /Incomplete: no metrics from the desktop job[\s\S]*1 page and profile/);
  });

  const hostile: [string, (a: Artifact) => void][] = [
    ['an injected page name', (a) => Object.assign(a.results[0] ?? {}, { page: injection })],
    [
      'an inherited property as a page name',
      (a) => Object.assign(a.results[0] ?? {}, { page: 'constructor' }),
    ],
    ['an unknown profile', (a) => Object.assign(a.results[0] ?? {}, { profile: 'tablet' })],
    [
      'a metric name with markup in `over`',
      (a) => Object.assign(a.results[0] ?? {}, { over: [injection] }),
    ],
    ['a repeated metric', (a) => Object.assign(a.results[1] ?? {}, { regressed: ['lcp', 'lcp'] })],
    ['a huge number', (a) => Object.assign(a.results[0]?.head ?? {}, { lcp: 1e308 })],
    ['a negative number', (a) => Object.assign(a.results[0]?.head ?? {}, { tbt: -1 })],
    ['a score above 1', (a) => Object.assign(a.results[0]?.head ?? {}, { performance: 100 })],
    ['a number as a string', (a) => Object.assign(a.results[0]?.head ?? {}, { cls: '0.1' })],
    ['an extra field at the top', (a) => Object.assign(a, { note: injection })],
    ['an extra field in a result', (a) => Object.assign(a.results[0] ?? {}, { url: injection })],
    ['an extra metric', (a) => Object.assign(a.results[0]?.head ?? {}, { fcp: 1 })],
    [
      'a missing metric',
      (a) => {
        const { cls: _, ...head } = values();
        Object.assign(a.results[0] ?? {}, { head });
      },
    ],
    ['a repeated page and profile', (a) => a.results.push(a.results[0] as never)],
    ['more results than pages × profiles', (a) => a.results.push(...Array(12).fill(a.results[0]))],
    ['no results', (a) => a.results.splice(0)],
    ['another version', (a) => Object.assign(a, { version: 2 })],
    ['a fractional run count', (a) => Object.assign(a, { runs: 2.5 })],
  ];
  for (const [name, change] of hostile) {
    it(`refuses ${name}, without repeating the artifact`, () => {
      assert.throws(
        () => validate(text(change)),
        (error: Error) => !/onerror|tablet|1e\+?308|note|url|fcp|constructor/.test(error.message)
      );
    });
  }

  it('refuses an own __proto__ key, which JSON.parse keeps as data', () => {
    const json = text().replace('{"version":1', '{"__proto__":{"polluted":true},"version":1');
    assert.throws(() => validate(json), /fields are not exactly/);
    assert.equal(({} as Record<string, unknown>).polluted, undefined);
  });

  it('refuses an artifact over the size limit, and anything that is not JSON', () => {
    const padded = text().replace('{"version"', `${' '.repeat(maxBytes)}{"version"`);
    assert.throws(() => validate(padded), /over 16384 bytes/);
    assert.throws(() => validate('{"version":1,'), /^Error: artifact: not JSON$/);
  });

  it('keeps the artifact under the limit at its largest: every page in both profiles', () => {
    const results = Object.keys(pages).flatMap((page) =>
      ['mobile', 'desktop'].map((profile) => ({
        page,
        profile,
        head: values({ lcp: 119_999.123456789, cls: 9.123456789 }),
        base: values({ lcp: 119_999.123456789 }),
        over: Object.keys(metrics),
        regressed: Object.keys(metrics),
      }))
    );
    validate(JSON.stringify({ version: 1, runs: 9, results }));
  });

  it('knows exactly the pages and metrics budgets.json measures', () => {
    assert.deepEqual(Object.keys(pages), Object.keys(budgets.lighthouse.pages));
    for (const profile of ['mobile', 'desktop'] as const) {
      assert.deepEqual(
        Object.keys(budgets.lighthouse.assert[profile]).sort(),
        Object.keys(metrics).sort()
      );
    }
  });
});

describe('the render command', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'min7-lighthouse-report-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const run = (...contents: string[]) => {
    const files = contents.map((content, i) => {
      writeFileSync(join(dir, `metrics-${i}.json`), content);
      return `metrics-${i}.json`;
    });
    return spawnSync(process.execPath, [report, 'render', ...files, 'comment.md'], {
      cwd: dir,
      encoding: 'utf8',
    });
  };
  const only = (profile: string) =>
    text((a) => {
      a.results = a.results.filter((r) => r.profile === profile);
    });

  it('writes no comment and exits 1 for an oversized or hostile artifact', () => {
    for (const content of [' '.repeat(maxBytes + 1), text((a) => Object.assign(a, { x: 1 }))]) {
      const result = run(content);
      assert.equal(result.status, 1);
      assert.ok(!existsSync(join(dir, 'comment.md')));
    }
  });

  it('writes the comment for a valid artifact', () => {
    assert.equal(run(text()).status, 0);
    assert.equal(readFileSync(join(dir, 'comment.md'), 'utf8'), render(validate(text())));
  });

  it('merges the profile jobs into one comment, and refuses a profile reported twice', () => {
    assert.equal(run(only('mobile'), only('desktop')).status, 0);
    assert.equal(readFileSync(join(dir, 'comment.md'), 'utf8'), render(validate(text())));
    assert.throws(() => merge([validate(text()), validate(text())]), /repeat a page and profile/);
    assert.throws(
      () => merge([validate(only('mobile')), validate(text((a) => Object.assign(a, { runs: 5 })))]),
      /runs differ/
    );
    const third = validate(only('desktop'));
    assert.throws(() => merge([third, third, third]), /not 1 to 2 files/);
    const bad = run(
      only('mobile'),
      text((a) => Object.assign(a, { x: 1 }))
    );
    assert.equal(bad.status, 1);
  });
});

describe('ci.yml', () => {
  const workflow = parse(workflowText) as {
    jobs: Record<string, { permissions?: unknown; needs?: unknown; if?: string; steps: Step[] }>;
  };
  interface Step {
    uses?: string;
    if?: string;
    run?: string;
    with?: Record<string, string>;
    env?: Record<string, string>;
  }
  const comment = workflow.jobs['lighthouse-comment'];
  assert.ok(comment);

  it('runs the same validator as scripts/lighthouse-report.js (just lighthouse-embed)', () => {
    assert.equal(embedded(workflowText), readFileSync(report, 'utf8'));
  });

  it('gives the comment job pull-requests: write only, no checkout, no other action', () => {
    assert.deepEqual(comment.permissions, { 'pull-requests': 'write' });
    const actions = comment.steps.flatMap((step) => (step.uses ? [step.uses] : []));
    assert.equal(actions.length, 1);
    assert.match(actions[0] ?? '', /^actions\/download-artifact@[0-9a-f]{40}$/);
    assert.deepEqual(comment.steps[0]?.with?.pattern, 'lighthouse-metrics-*');
    assert.ok(!comment.steps.some((step) => /\b(?:git|pnpm|npm|npx|just)\b/.test(step.run ?? '')));
  });

  const lighthouse = workflow.jobs.lighthouse;
  assert.ok(lighthouse);
  const cacheSteps = (action: 'restore' | 'save') =>
    lighthouse.steps.filter((step) => step.uses?.startsWith(`actions/cache/${action}@`));

  it('saves only on a push, at the path pull requests restore (part of a cache version)', () => {
    const [restore] = cacheSteps('restore');
    assert.ok(restore?.with?.path);
    const saves = cacheSteps('save');
    assert.ok(saves.length > 0);
    for (const save of saves) assert.equal(save.with?.path, restore.with.path);
    // A pull request run never writes the cache (ADR 0017): every save is for a push only.
    for (const save of saves) assert.match(save.if ?? '', /github\.event_name == 'push'/);
    // The numbers a push saves are the commit's own, under that commit's key.
    assert.match(saves.at(-1)?.with?.key ?? '', /-\$\{\{ github\.sha \}\}$/);
    assert.match(
      restore.with.key ?? '',
      /\{\{ github\.event\.pull_request\.base\.sha \|\| github\.event\.before \}\}$/
    );
  });

  it('skips the comment job on forks and outside pull requests', () => {
    assert.match(
      comment.if ?? '',
      /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/
    );
    assert.match(comment.if ?? '', /github\.event_name == 'pull_request'/);
  });

  describe('the post step', () => {
    let dir: string;
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'min7-lighthouse-post-'));
      // A stand-in gh: answers the comment listing from comments.json through the real jq and
      // records every other call with the body it would send.
      writeFileSync(
        join(dir, 'gh'),
        [
          '#!/usr/bin/env bash',
          'set -euo pipefail',
          'if [[ " $* " == *" --paginate "* ]]; then',
          '  while [[ "$1" != "--jq" ]]; do shift; done',
          '  jq -r "$2" comments.json',
          '  exit 0',
          'fi',
          'echo "$*" >> calls.log',
          'jq -r .body request.json > sent.md',
        ].join('\n')
      );
      chmodSync(join(dir, 'gh'), 0o755);
      writeFileSync(join(dir, 'comment.md'), render(validate(text())));
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    const post = (comments: unknown[]) => {
      writeFileSync(join(dir, 'comments.json'), JSON.stringify(comments));
      const step = comment.steps.find((s) => s.run?.includes('gh api'));
      execFileSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', step?.run ?? ''], {
        cwd: dir,
        env: {
          PATH: `${dir}:${process.env.PATH}`,
          HOME: dir,
          REPO: 'o/r',
          PR: '7',
          GH_TOKEN: 'fake',
        },
      });
      return readFileSync(join(dir, 'calls.log'), 'utf8').trim();
    };

    it('creates the comment when the bot has none, ignoring a copied marker', () => {
      const copied = { id: 1, user: { login: 'someone' }, body: `${marker}\nfake` };
      assert.equal(
        post([copied]),
        'api --method POST repos/o/r/issues/7/comments --input request.json'
      );
      assert.equal(
        readFileSync(join(dir, 'sent.md'), 'utf8').trim(),
        readFileSync(join(dir, 'comment.md'), 'utf8').trim()
      );
    });

    it("updates the bot's own comment instead of adding another", () => {
      const own = { id: 42, user: { login: 'github-actions[bot]' }, body: `${marker}\nold` };
      const other = { id: 43, user: { login: 'github-actions[bot]' }, body: 'unrelated' };
      assert.equal(
        post([other, own]),
        'api --method PATCH repos/o/r/issues/comments/42 --input request.json'
      );
    });
  });
});
