// scripts/lighthouse.ts as CI runs it, with stand-ins for its two binaries in the head site's
// node_modules/.bin: a `wrangler dev` that serves dist/ (404 for a missing page, 500 for one
// whose file starts with FAIL), and an `lhci collect` that, like the pinned one, exits 1 when a
// page does not answer 200 and otherwise writes one result per run. Chromium is never started.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, it } from 'node:test';

const script = join(import.meta.dirname, 'lighthouse.ts');

const wrangler = `#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
const port = Number(process.argv[process.argv.indexOf('--port') + 1]);
createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname.replace(/^\\/$/, '/index').replace(/\\/$/, '');
  const file = [join('dist', path), join('dist', path + '.html')].find(
    (f) => existsSync(f) && statSync(f).isFile()
  );
  const body = file ? readFileSync(file, 'utf8') : 'not found';
  res.statusCode = !file ? 404 : body.startsWith('FAIL') ? 500 : 200;
  res.end(body);
}).listen(port, '127.0.0.1');
`;

const lhci = `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
const urls = process.argv.filter((a) => a.startsWith('--url=')).map((a) => a.slice(6));
const runs = Number(process.argv.find((a) => a.startsWith('--numberOfRuns=')).split('=')[1]);
mkdirSync('.lighthouseci', { recursive: true });
let n = 0;
for (const url of urls) {
  const status = (await fetch(url)).status;
  if (status !== 200) {
    console.error('Lighthouse failed on ' + url + ' (status ' + status + ')');
    process.exit(1);
  }
  for (let run = 0; run < runs; run++) {
    const lhr = {
      requestedUrl: url,
      categories: { performance: { score: 1 }, accessibility: { score: 1 }, 'best-practices': { score: 1 } },
      audits: {
        'largest-contentful-paint': { numericValue: 400 },
        'total-blocking-time': { numericValue: 0 },
        'cumulative-layout-shift': { numericValue: 0 },
      },
    };
    writeFileSync('.lighthouseci/lhr-' + n++ + '.json', JSON.stringify(lhr));
  }
}
`;

const pages = {
  'index.html': 'home',
  'index.txt': 'home',
  'writing.html': 'writing',
  'writing/old-post.html': 'an old post',
  'projects.html': 'projects',
  'projects/a.html': 'a project',
  'about.html': 'about',
  'stats.html': 'stats',
};

let dir: string;
const site = (name: string, files: Record<string, string>, bin = false) => {
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name, 'dist', file)), { recursive: true });
    writeFileSync(join(dir, name, 'dist', file), content);
  }
  if (!bin) return;
  mkdirSync(join(dir, name, 'node_modules/.bin'), { recursive: true });
  for (const [binary, source] of Object.entries({ wrangler, lhci })) {
    writeFileSync(join(dir, name, 'node_modules/.bin', binary), source);
    chmodSync(join(dir, name, 'node_modules/.bin', binary), 0o755);
  }
};
const run = () =>
  spawnSync(
    process.execPath,
    [
      script,
      '--base',
      'base',
      '--head',
      'head',
      '--profile',
      'desktop',
      '--out',
      'out/metrics.json',
    ],
    {
      cwd: dir,
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: dir, CHROME_PATH: '/nonexistent' },
    }
  );

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'min7-lighthouse-cli-'));
  site('base', pages);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

it('measures a new largest post on head and shows it as new, without failing the run', () => {
  site('head', { ...pages, 'writing/new-post.html': 'a new post, longer than the old one' }, true);
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  const { results } = JSON.parse(readFileSync(join(dir, 'out/metrics.json'), 'utf8'));
  const post = results.find((r: { page: string }) => r.page === 'post');
  assert.equal(post.base, null);
  assert.equal(post.head.lcp, 400);
  assert.ok(
    results.filter((r: { base: unknown }) => r.base !== null).length === results.length - 1
  );
});

it('still fails when an existing base page cannot be measured', () => {
  site('head', pages, true);
  site('base', { 'about.html': 'FAIL: the base build is broken' });
  const result = run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /about/);
});
