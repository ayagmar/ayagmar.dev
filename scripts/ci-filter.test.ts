// What the gate decides for realistic changes, and that ci.yml runs exactly the jobs the plan
// knows about. Run in the `workflows` job and by `just test-scripts`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { classify, gate, type Job, jobs, plan } from './ci.ts';

const allJobs = Object.keys(jobs) as Job[];

/** The jobs a change runs. */
const runs = (files: string[]) =>
  Object.entries(plan(classify(files)))
    .filter(([, on]) => on)
    .map(([job]) => job)
    .sort();

/** The `needs` context GitHub hands the gate when every planned job ends with `result`. */
function needsFor(files: string[], results: Partial<Record<Job, string>> = {}) {
  const planned: Partial<Record<Job, boolean>> = plan(classify(files));
  const needs: Record<string, { result: string; outputs?: Record<string, string> }> = {
    changes: { result: 'success', outputs: { plan: JSON.stringify(planned) } },
  };
  for (const job of allJobs) {
    needs[job] = { result: results[job] ?? (planned[job] ? 'success' : 'skipped') };
  }
  return needs;
}

describe('plan', () => {
  it('builds and checks the output of a content-only change, without unit tests', () => {
    assert.deepEqual(runs(['content/writing/new-post.md']), [
      'e2e',
      'format',
      'links',
      'secrets-source',
      'site-build',
    ]);
  });

  it('gives a signals-only change the full static checks but no site build', () => {
    const jobs = runs(['apps/signals/src/routes/v1/health.ts']);
    assert.deepEqual(jobs, ['checks', 'codeql', 'format', 'secrets-source', 'signals-test']);
  });

  it('builds, link-checks and runs the headers test for a public _headers change', () => {
    const jobs = runs(['apps/site/public/_headers']);
    for (const job of ['site-build', 'e2e', 'links', 'site-test']) assert.ok(jobs.includes(job));
  });

  it('link-checks a source-only change that can move pages', () => {
    const jobs = runs(['apps/site/src/pages/writing/[slug].astro']);
    for (const job of ['links', 'e2e', 'checks', 'site-test']) assert.ok(jobs.includes(job));
    assert.ok(!jobs.includes('signals-test'));
  });

  it('runs every unit and the tool checks for a root justfile change', () => {
    const jobs = runs(['justfile']);
    for (const job of allJobs.filter((j) => !['osv', 'shell'].includes(j))) {
      assert.ok(jobs.includes(job), `${job} should run`);
    }
  });

  it('builds and tests both Workers and the site output when only bootstrap.sh changes', () => {
    const jobs = runs(['scripts/bootstrap.sh']);
    for (const job of ['signals-test', 'site-build', 'e2e', 'links', 'checks', 'renovate']) {
      assert.ok(jobs.includes(job), `${job} should run`);
    }
  });

  it('runs both apps, the contracts and the site output for a shared fixture change', () => {
    const jobs = runs(['packages/contracts/fixtures/lastfm/raw/ok.json']);
    for (const job of ['contracts', 'signals-test', 'site-test', 'site-build', 'e2e', 'links']) {
      assert.ok(jobs.includes(job), `${job} should run`);
    }
  });

  it('tests and builds the site for a change to its data layer', () => {
    const jobs = runs(['apps/site/src/data/reader.ts']);
    for (const job of ['checks', 'site-test', 'site-build', 'e2e', 'links']) {
      assert.ok(jobs.includes(job), `${job} should run`);
    }
    assert.ok(!jobs.includes('signals-test'));
  });

  for (const file of [
    'apps/signals/migrations/0002_add_column.sql',
    'apps/signals/src/cron/run.ts',
    'apps/signals/wrangler.jsonc',
    'apps/signals/.dev.vars.example',
  ]) {
    it(`runs the Worker checks, tests and bundle for ${file}`, () => {
      const jobs = runs([file]);
      for (const job of ['checks', 'signals-test', 'codeql'])
        assert.ok(jobs.includes(job), `${job} should run`);
      assert.ok(!jobs.includes('site-build'));
    });
  }

  it('runs the union for mixed changes', () => {
    const jobs = runs(['content/writing/a.md', '.github/workflows/ci.yml', 'scripts/bootstrap.sh']);
    for (const job of ['links', 'site-build', 'workflows', 'renovate', 'shell', 'checks']) {
      assert.ok(jobs.includes(job), `${job} should run`);
    }
  });

  it('scans dependencies only when they change', () => {
    assert.ok(runs(['apps/site/package.json', 'pnpm-lock.yaml']).includes('osv'));
    assert.ok(!runs(['apps/site/src/lib/feed.ts']).includes('osv'));
  });

  it('checks workflows and nothing else for a workflow-only change', () => {
    assert.deepEqual(runs(['.github/workflows/ci.yml']), ['format', 'secrets-source', 'workflows']);
  });
});

describe('gate', () => {
  it('passes when planned jobs succeed and the rest are skipped', () => {
    assert.deepEqual(gate(needsFor(['content/writing/new-post.md'])), []);
  });

  it('fails a signals change whose type check failed', () => {
    const needs = needsFor(['apps/signals/src/index.ts'], { checks: 'failure' });
    assert.deepEqual(gate(needs), ['checks: failure, expected success']);
  });

  it('fails when a planned job was skipped, for example after a failed build', () => {
    const needs = needsFor(['apps/site/src/pages/index.astro'], {
      'site-build': 'failure',
      e2e: 'skipped',
      links: 'skipped',
    });
    assert.deepEqual(gate(needs), [
      'site-build: failure, expected success',
      'e2e: skipped, expected success',
      'links: skipped, expected success',
    ]);
  });

  it('fails when a job ran that the plan skipped', () => {
    const needs = needsFor(['content/writing/a.md'], { 'signals-test': 'success' });
    assert.deepEqual(gate(needs), ['signals-test: success, but the plan skipped it']);
  });

  for (const result of ['failure', 'cancelled', 'skipped']) {
    it(`fails when the changes job is ${result}`, () => {
      const needs = needsFor(['content/writing/a.md']);
      needs.changes = { result };
      assert.equal(gate(needs).length, 1);
    });
  }

  it('fails when the plan has no decision for a job', () => {
    const planned: Partial<Record<Job, boolean>> = plan(classify(['content/writing/a.md']));
    delete planned.links;
    const needs = needsFor(['content/writing/a.md']);
    needs.changes = { result: 'success', outputs: { plan: JSON.stringify(planned) } };
    assert.deepEqual(gate(needs), ['links: the plan has no decision for it']);
  });

  it('fails when a job is missing from needs or unknown to the plan', () => {
    const needs = needsFor(['content/writing/a.md']);
    delete needs.links;
    needs.lighthouse = { result: 'success' };
    assert.deepEqual(gate(needs), [
      'lighthouse: not in scripts/ci.ts jobs',
      "links: missing from the gate's needs",
    ]);
  });
});

describe('ci.yml', () => {
  const workflow = readFileSync(
    join(import.meta.dirname, '..', '.github/workflows/ci.yml'),
    'utf8'
  );
  const body = workflow.slice(workflow.indexOf('\njobs:\n'));
  const defined = [...body.matchAll(/^ {2}([a-z0-9-]+):$/gm)].map(([, id]) => id as string);
  const block = (id: string) => {
    const start = body.indexOf(`\n  ${id}:\n`);
    const next = body.slice(start + 1).search(/\n {2}[a-z0-9-]+:\n/);
    return next === -1 ? body.slice(start) : body.slice(start, start + 1 + next);
  };

  it('defines exactly the planned jobs plus changes and gate', () => {
    assert.deepEqual([...defined].sort(), [...allJobs, 'changes', 'gate'].sort());
  });

  it('makes the gate need every job and always run', () => {
    const gateJob = block('gate');
    assert.match(gateJob, /if: \$\{\{ always\(\) \}\}/);
    const needs = /needs:\s*\[([^\]]*)\]/
      .exec(gateJob)?.[1]
      ?.split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    assert.deepEqual(needs?.sort(), [...allJobs, 'changes'].sort());
  });

  for (const job of allJobs) {
    it(`runs ${job} only when the plan says so`, () => {
      assert.ok(
        block(job).includes(`if: fromJSON(needs.changes.outputs.plan).${job}`),
        `${job} needs \`if: fromJSON(needs.changes.outputs.plan).${job}\``
      );
    });
  }
});
