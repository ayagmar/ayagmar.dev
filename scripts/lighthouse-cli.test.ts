// scripts/lighthouse.ts as CI runs it, with stand-ins for its two binaries in the head site's
// node_modules/.bin: a `wrangler dev` that serves dist/ (404 for a missing page, 500 for one
// whose file starts with FAIL), and an `lhci collect` that, like the pinned one, exits 1 when a
// page does not answer 200 and otherwise writes one result per run. Chromium is never started.
// A page's file sets what the stand-in measures: `lcp:N` its LCP (400 ms otherwise), `drift`
// adds 40 ms for every run of a drifting page before it (a runner slowing down), `cls:a,b,...`
// the CLS of its successive runs (the last repeats; 0 otherwise), `crash` makes
// Lighthouse crash on it as NO_NAVSTART does; a `crash-once` file next to the stand-in makes
// the next collect crash. Each measured URL is appended to `calls.log` there.
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, it } from 'node:test';
import { promisify } from 'node:util';

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
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
const here = dirname(process.argv[1]);
const crash = () => {
  console.error('Runtime error encountered: NO_NAVSTART');
  process.exit(1);
};
if (existsSync(join(here, 'crash-once'))) {
  rmSync(join(here, 'crash-once'));
  crash();
}
const urls = process.argv.filter((a) => a.startsWith('--url=')).map((a) => a.slice(6));
const runs = Number(process.argv.find((a) => a.startsWith('--numberOfRuns=')).split('=')[1]);
mkdirSync('.lighthouseci', { recursive: true });
let n = 0;
for (const url of urls) {
  const response = await fetch(url);
  const body = await response.text();
  if (response.status !== 200) {
    console.error('Lighthouse failed on ' + url + ' (status ' + response.status + ')');
    process.exit(1);
  }
  if (body.includes('crash')) crash();
  for (let run = 0; run < runs; run++) {
    appendFileSync(join(here, 'calls.log'), new URL(url).pathname + '\\n');
    let lcp = Number(/lcp:(\\d+)/.exec(body)?.[1] ?? 400);
    const clsList = (/cls:([\\d.,]+)/.exec(body)?.[1] ?? '0').split(',').map(Number);
    const seen = join(here, 'cls-count-' + new URL(url).pathname.replaceAll('/', '_'));
    const clsRun = existsSync(seen) ? Number(readFileSync(seen, 'utf8')) : 0;
    writeFileSync(seen, String(clsRun + 1));
    const cls = clsList[Math.min(clsRun, clsList.length - 1)];
    if (body.includes('drift')) {
      const counter = join(here, 'drift-count');
      const count = existsSync(counter) ? Number(readFileSync(counter, 'utf8')) : 0;
      writeFileSync(counter, String(count + 1));
      lcp += 40 * count;
    }
    const lhr = {
      requestedUrl: url,
      categories: { performance: { score: 1 }, accessibility: { score: 1 }, 'best-practices': { score: 1 } },
      audits: {
        'largest-contentful-paint': { numericValue: lcp },
        'total-blocking-time': { numericValue: 0 },
        'cumulative-layout-shift': { numericValue: cls },
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
  'uses.html': 'uses',
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
const run = (...extra: string[]) =>
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
      ...extra,
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

it('measures the base once: a cache hit needs no base build, a stale entry is not refreshed', () => {
  site('head', pages, true);
  const first = run('--base-cache', 'out/base.json', '--head-cache', 'out/head.json');
  assert.equal(first.status, 0, first.stderr);
  const cache = JSON.parse(readFileSync(join(dir, 'out/base.json'), 'utf8'));
  assert.deepEqual(Object.keys(cache.profiles.desktop).sort(), [
    '/',
    '/about',
    '/projects',
    '/projects/a',
    '/stats',
    '/uses',
    '/writing',
    '/writing/old-post',
  ]);
  // What the head cache holds is what CI keeps for the next pull request's base.
  const head = JSON.parse(readFileSync(join(dir, 'out/head.json'), 'utf8'));
  assert.deepEqual(head, cache);

  // The base is gone and the cache says LCP was 380 ms there: the result must use the cache.
  cache.profiles.desktop['/'].lcp = 380;
  writeFileSync(join(dir, 'out/base.json'), JSON.stringify(cache));
  rmSync(join(dir, 'base'), { recursive: true });
  const second = run('--base-cache', 'out/base.json');
  assert.equal(second.status, 0, second.stderr);
  const { results } = JSON.parse(readFileSync(join(dir, 'out/metrics.json'), 'utf8'));
  assert.equal(results.find((r: { page: string }) => r.page === 'home').base.lcp, 380);
  assert.ok(results.every((r: { base: unknown }) => r.base !== null));
});

it('measures only the pages a cache lacks, and treats a cache it cannot read as empty', () => {
  site('head', pages, true);
  writeFileSync(join(dir, 'garbage.json'), '{"version":2}');
  mkdirSync(join(dir, 'out'), { recursive: true });
  const result = run('--base-cache', 'garbage.json');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /ignoring the cache garbage\.json/);
  const { results } = JSON.parse(readFileSync(join(dir, 'out/metrics.json'), 'utf8'));
  assert.ok(results.every((r: { base: unknown }) => r.base !== null));
  // The cache the run wrote replaces the unreadable file.
  assert.ok(existsSync(join(dir, 'garbage.json')));
  assert.equal(JSON.parse(readFileSync(join(dir, 'garbage.json'), 'utf8')).version, 1);
});

// A base cache as a main push leaves it: every page measured, LCP 400 ms unless given.
const cache = (lcp: Record<string, number> = {}) => {
  const paths = ['/', '/about', '/projects', '/projects/a', '/stats', '/uses', '/writing'];
  const byPath = Object.fromEntries(
    [...paths, '/writing/old-post'].map((path) => [
      path,
      { performance: 1, accessibility: 1, bestPractices: 1, lcp: lcp[path] ?? 400, tbt: 0, cls: 0 },
    ])
  );
  writeFileSync(
    join(dir, 'base.json'),
    JSON.stringify({ version: 1, profiles: { desktop: byPath } })
  );
};
const metricsFile = () =>
  JSON.parse(readFileSync(join(dir, 'out/metrics.json'), 'utf8')) as {
    results: {
      page: string;
      base: { lcp: number };
      head: { lcp: number };
      over: string[];
      regressed: string[];
      remeasured: { base: { lcp: number } | null; head: { lcp: number; cls: number } } | null;
    }[];
  };
const row = (page: string) => metricsFile().results.find((r) => r.page === page);
const calls = () =>
  readFileSync(join(dir, 'head/node_modules/.bin/calls.log'), 'utf8').trim().split('\n');

it('passes a page that only looked regressed against a lucky cached base, measuring only it again', () => {
  // The cache says /projects read 400 ms; this runner reads 500 ms on both builds and slows by
  // 40 ms a run. Measured in turn, base and head stay one run apart; measured one side after
  // the other, head would read 120 ms worse, past desktop's 100 ms allowance.
  const projects = { 'projects.html': 'lcp:500 drift' };
  site('base', { ...pages, ...projects });
  site('head', { ...pages, ...projects }, true);
  cache();
  const result = run('--base-cache', 'base.json');
  assert.equal(result.status, 0, result.stderr);
  const projectsRow = row('projects');
  assert.equal(projectsRow?.base.lcp, 400);
  assert.equal(projectsRow?.head.lcp, 540);
  assert.deepEqual(
    projectsRow?.remeasured && [projectsRow.remeasured.base?.lcp, projectsRow.remeasured.head.lcp],
    [700, 740]
  );
  assert.deepEqual(projectsRow?.regressed, []);
  assert.ok(metricsFile().results.every((r) => r.page === 'projects' || r.remeasured === null));
  // 8 pages × 3 runs on head, then only /projects: 3 runs on each side.
  assert.deepEqual(calls().slice(24), Array(6).fill('/projects'));
});

it('still fails a regression that holds against the base measured beside it', () => {
  site('base', { ...pages, 'projects.html': 'lcp:500' });
  site('head', { ...pages, 'projects.html': 'lcp:800' }, true);
  cache({ '/projects': 500 });
  const result = run('--base-cache', 'base.json');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /projects \(desktop\): lcp regressed from 500 to 800, re-measured/);
  assert.deepEqual(row('projects')?.regressed, ['lcp']);
});

it('fails, naming the cause, when the re-measure cannot run', () => {
  site('base', { ...pages, 'projects.html': 'lcp:500 crash' });
  site('head', { ...pages, 'projects.html': 'lcp:800' }, true);
  cache({ '/projects': 500 });
  const result = run('--base-cache', 'base.json');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /NO_NAVSTART/);
  assert.match(
    result.stderr,
    /projects \(desktop\): the re-measure failed, so the first numbers stand: lhci collect .* exited with 1 again/
  );
  assert.equal(row('projects')?.remeasured, null);
  assert.deepEqual(row('projects')?.regressed, ['lcp']);
});

it('measures head alone again for a CLS budget miss, and fails only a miss that repeats', () => {
  // No base at all: a CLS budget is absolute, so its re-measure needs none.
  const head = (writing: string) => {
    rmSync(join(dir, 'head'), { recursive: true, force: true });
    site('head', { ...pages, 'writing.html': writing }, true);
    return spawnSync(
      process.execPath,
      [script, '--head', 'head', '--profile', 'desktop', '--out', 'out/metrics.json'],
      { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir, CHROME_PATH: '/x' } }
    );
  };
  // #52: 0.0102 three times, then the page's usual 0.0015.
  const noise = head('cls:0.0102,0.0102,0.0102,0.0015');
  assert.equal(noise.status, 0, noise.stderr);
  assert.deepEqual(row('writing')?.over, []);
  assert.equal(row('writing')?.remeasured?.head.cls, 0.0015);
  assert.equal(row('writing')?.remeasured?.base, null);
  assert.deepEqual(calls().slice(24), Array(3).fill('/writing'));

  const shifted = head('cls:0.0515');
  assert.equal(shifted.status, 1);
  assert.match(shifted.stderr, /writing \(desktop\): cls 0\.0515 over budget, re-measured/);
  assert.deepEqual(row('writing')?.over, ['cls']);
});

it('runs a crashed lhci collect once more, and fails with its error when it crashes again', () => {
  site('head', pages, true);
  writeFileSync(join(dir, 'head/node_modules/.bin/crash-once'), '');
  const once = run();
  assert.equal(once.status, 0, once.stderr);
  assert.match(once.stderr, /NO_NAVSTART[\s\S]*exited with 1; running it once more/);

  site('head', { 'about.html': 'crash' });
  const twice = run();
  assert.equal(twice.status, 1);
  assert.match(twice.stderr, /NO_NAVSTART[\s\S]*NO_NAVSTART/);
  assert.match(twice.stderr, /lighthouse: lhci collect on .* \(desktop\) exited with 1 again/);
});

it('serves on free ports, so ports another run or a leftover server holds do not matter', async () => {
  site('head', pages, true);
  // The ports the script used to take; if one is held already, that is the same situation.
  const held = await Promise.all(
    [8791, 8792].map(
      (port) =>
        new Promise<ReturnType<typeof createServer>>((resolve) => {
          const server = createServer((_req, res) => res.writeHead(503).end()).once('error', () =>
            resolve(server)
          );
          server.listen(port, '127.0.0.1', () => resolve(server));
        })
    )
  );
  try {
    // Asynchronous, so the servers holding the ports keep answering while the script runs.
    await promisify(execFile)(
      process.execPath,
      [script, '--head', 'head', '--profile', 'desktop', '--out', 'out/metrics.json'],
      {
        cwd: dir,
        timeout: 60_000,
        env: { PATH: process.env.PATH, HOME: dir, CHROME_PATH: '/nonexistent' },
      }
    );
  } finally {
    for (const server of held) server.close();
  }
});
