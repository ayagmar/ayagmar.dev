// The Preview links workflow's step run for real against a stand-in `gh` and `curl`: which pull
// request it comments on, and what the comment says.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { parse } from 'yaml';

type Job = { env: Record<string, string>; steps: { run: string }[] };
const workflow: { jobs: { comment: Job } } = parse(
  readFileSync(join(import.meta.dirname, '../.github/workflows/preview-links.yml'), 'utf8')
);
const job = workflow.jobs.comment;

const repo = 'ayagmar/min7';
const sha = 'a'.repeat(40);
const newer = 'b'.repeat(40);
const pull = (number: number, over: { sha?: string; repo?: string } = {}) => ({
  number,
  state: 'open',
  head: { ref: 'feat/x', sha: over.sha ?? sha, repo: { full_name: over.repo ?? repo } },
});
const details = (worker: string) =>
  `https://dash.cloudflare.com/acct/workers/services/view/${worker}/previews/abc123/builds/1`;
const check = (worker: string, conclusion: string | null) => ({
  name: `Workers Builds: ${worker}`,
  app: { slug: 'cloudflare-workers-and-pages' },
  conclusion,
  started_at: '2026-10-26T10:00:00Z',
  details_url: details(worker),
});
const built = [check('min7-site', 'success'), check('min7-signals', 'success')];
const ownComment = {
  id: 42,
  user: { login: 'github-actions[bot]' },
  body: '<!-- min7-preview-links -->\nold',
};

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'min7-preview-links-'));
  mkdirSync(join(dir, 'api'));
  // A stand-in gh: answers each GET from api/<path>.json through the real jq and records every
  // write with the body it would send.
  writeFileSync(
    join(dir, 'gh'),
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'shift',
      'method=GET filter=. body=""',
      'while (($#)); do',
      '  case $1 in',
      '    --method) method=$2; shift 2 ;;',
      '    --jq) filter=$2; shift 2 ;;',
      '    -f) body=$2; shift 2 ;;',
      '    --paginate) shift ;;',
      '    *) path=$(cut -d \'?\' -f 1 <<<"$1"); shift ;;',
      '  esac',
      'done',
      'if [[ $method != GET ]]; then',
      '  echo "$method $path" >> writes.log',
      "  printf '%s' \"$body\" | sed '1s/^body=//' > body.md",
      '  exit 0',
      'fi',
      'jq -r "$filter" "api/$(tr / _ <<<"$path").json"',
    ].join('\n')
  );
  // Every Preview answers. The first probe runs on-curl.sh, if a test wrote one, to stand in
  // for what happens elsewhere while this run waits on the Preview.
  writeFileSync(
    join(dir, 'curl'),
    '#!/usr/bin/env bash\nif [[ -f on-curl.sh ]]; then mv on-curl.sh probing.sh; bash probing.sh; fi\n'
  );
  chmodSync(join(dir, 'gh'), 0o755);
  chmodSync(join(dir, 'curl'), 0o755);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const apiFile = (path: string) =>
  join('api', `repos_${repo.replace('/', '_')}_${path.replaceAll('/', '_')}.json`);
const api = (path: string, body: unknown) =>
  writeFileSync(join(dir, apiFile(path)), JSON.stringify(body));

const run = (event: {
  prs: { number: number }[];
  branch?: string;
  checks?: unknown[];
  comments?: unknown[];
}) => {
  api(`commits/${sha}/check-runs`, { check_runs: event.checks ?? built });
  api('issues/7/comments', event.comments ?? []);
  writeFileSync(join(dir, 'step.sh'), job.steps[0]?.run ?? '');
  const log = execFileSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', 'step.sh'], {
    cwd: dir,
    encoding: 'utf8',
    env: {
      PATH: `${dir}:${process.env.PATH}`,
      HOME: dir,
      GH_TOKEN: 'fake',
      REPO: repo,
      SHA: sha,
      EVENT_PRS: JSON.stringify(event.prs),
      BRANCH: event.branch ?? 'feat/x',
      SUBDOMAIN: job.env.SUBDOMAIN,
    },
  });
  const read = (file: string) =>
    existsSync(join(dir, file)) ? readFileSync(join(dir, file), 'utf8') : '';
  return { log, writes: read('writes.log').trim(), body: read('body.md') };
};

describe('preview-links', () => {
  it('comments on the same-repository pull request whose head is the checked commit', () => {
    api('pulls/7', pull(7));
    const { writes, body } = run({ prs: [{ number: 7 }] });
    assert.equal(writes, `POST repos/${repo}/issues/7/comments`);
    assert.match(body, /\| `min7-site` \| https:\/\/abc123-min7-site\.ayagmar\.workers\.dev\/ \|/);
    assert.match(
      body,
      /\| `min7-signals` \| https:\/\/abc123-min7-signals\.ayagmar\.workers\.dev\/v1\/health \|/
    );
  });

  it("skips a fork's pull request from a branch of the same name", () => {
    api(`commits/${sha}/pulls`, [pull(8, { repo: 'someone/min7' }), pull(7)]);
    api('pulls/8', pull(8, { repo: 'someone/min7' }));
    api('pulls/7', pull(7));
    assert.equal(run({ prs: [] }).writes, `POST repos/${repo}/issues/7/comments`);
  });

  it('leaves the comment alone when the check is for a commit the pull request has moved past', () => {
    api('pulls/7', pull(7, { sha: newer }));
    const { writes, log } = run({ prs: [{ number: 7 }], comments: [ownComment] });
    assert.equal(writes, '');
    assert.match(log, /head of 0 open pull requests/);
  });

  it("leaves the newer commit's comment alone when a push lands while this run probes", () => {
    api('pulls/7', pull(7));
    // While this run probes, the pull request moves to the newer commit, whose run posts its
    // own links.
    api(`commits/${newer}/check-runs`, { check_runs: built });
    writeFileSync(join(dir, 'pull-7-newer.json'), JSON.stringify(pull(7, { sha: newer })));
    writeFileSync(
      join(dir, 'on-curl.sh'),
      `mv pull-7-newer.json ${apiFile('pulls/7')}\nSHA=${newer} bash --noprofile --norc -eo pipefail step.sh\n`
    );
    const { writes, body } = run({ prs: [{ number: 7 }], comments: [ownComment] });
    assert.equal(writes, `PATCH repos/${repo}/issues/comments/42`);
    assert.match(body, /Previews for bbbbbbb/);
  });

  it('keeps the logs link of a Worker that is still building', () => {
    api('pulls/7', pull(7));
    const { body } = run({
      prs: [{ number: 7 }],
      checks: [check('min7-site', 'success'), check('min7-signals', null)],
    });
    assert.match(body, /\| `min7-site` \| https:\/\/abc123-min7-site\.ayagmar\.workers\.dev\/ \|/);
    assert.ok(
      body.includes(`| \`min7-signals\` | build pending: [logs](${details('min7-signals')}) |`)
    );
  });

  it('finds the pull request by its commit when the check has no branch', () => {
    api(`commits/${sha}/pulls`, [pull(7)]);
    api('pulls/7', pull(7));
    assert.equal(
      run({ prs: [], branch: '', comments: [ownComment] }).writes,
      `PATCH repos/${repo}/issues/comments/42`
    );
  });
});
