// Lighthouse on the built site (ADR 0017): serves the head build, and the base build when given,
// each through its own Worker with `wrangler dev` (local, offline), runs Lighthouse CI on the
// pages in scripts/budgets.json for each profile, takes the median of the runs, and fails when
// a head page is over budget or regressed against the base beyond the noise allowance. Writes
// the metrics artifact (scripts/lighthouse-report.js has its schema) either way.
// Chromium comes from CHROME_PATH (`just lighthouse` sets it to Playwright's).
// Usage: node scripts/lighthouse.ts [--base <site dir>] [--head <site dir>]
//          [--profile mobile|desktop]... [--out <metrics.json>]
// A site dir is apps/site of a checkout, built: wrangler.jsonc, worker/ and dist/.
import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { budgets } from './budgets.ts';
import { pages as knownPages, metrics, profiles, render, validate } from './lighthouse-report.js';

type Profile = (typeof profiles)[number];
type Metric = keyof typeof metrics;
type Values = Record<Metric, number>;

const scores = new Set<Metric>(['performance', 'accessibility', 'bestPractices']);
const metricKeys = Object.keys(metrics) as Metric[];

/** The fields of a Lighthouse result this script reads. */
interface Lhr {
  requestedUrl: string;
  runtimeError?: { code: string };
  categories: Record<string, { score: number | null }>;
  audits: Record<string, { numericValue?: number }>;
}

/** One run's metrics, or null when Lighthouse could not measure the page (such as a 404). */
export function readLhr(lhr: Lhr): Values | null {
  if (lhr.runtimeError) return null;
  const score = (id: string) => lhr.categories[id]?.score;
  const audit = (id: string) => lhr.audits[id]?.numericValue;
  const values = {
    performance: score('performance'),
    accessibility: score('accessibility'),
    bestPractices: score('best-practices'),
    lcp: audit('largest-contentful-paint'),
    tbt: audit('total-blocking-time'),
    cls: audit('cumulative-layout-shift'),
  };
  for (const [key, value] of Object.entries(values)) {
    if (typeof value !== 'number') throw new Error(`${lhr.requestedUrl}: no ${key} in the result`);
  }
  return values as Values;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
};

/** The median of each metric over the runs, rounded to what Lighthouse reports. */
export function medians(runs: Values[]): Values {
  const out = {} as Values;
  for (const key of metricKeys) {
    const m = median(runs.map((run) => run[key]));
    out[key] =
      key === 'cls' ? Math.round(m * 10_000) / 10_000 : scores.has(key) ? m : Math.round(m);
  }
  return out;
}

/** Metrics over their budget for the profile. Scores are minimums, the rest maximums. */
export function overBudget(head: Values, profile: Profile): Metric[] {
  const limits = budgets.lighthouse.assert[profile];
  return metricKeys.filter((key) => {
    const limit = limits[key];
    if (limit === undefined) return false;
    return scores.has(key) ? head[key] < limit : head[key] > limit;
  });
}

/** Metrics worse than the base by more than both the ratio and the delta allow. */
export function regressions(head: Values, base: Values | null, profile: Profile): Metric[] {
  if (!base) return [];
  return metricKeys.filter((key) => {
    const rule = budgets.lighthouse.regression[profile][key];
    return !!rule && head[key] > base[key] * rule.ratio && head[key] - base[key] > rule.delta;
  });
}

/** The URL path of each page; a path ending in `/*` is the largest page directly under it. */
export function pagePaths(dist: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, path] of Object.entries(budgets.lighthouse.pages)) {
    if (!Object.hasOwn(knownPages, name)) {
      throw new Error(`budgets.json: page ${name} is not in lighthouse-report.js pages`);
    }
    if (!path.endsWith('/*')) {
      out[name] = path;
      continue;
    }
    const dir = path.slice(1, -2);
    const candidates = readdirSync(join(dist, dir))
      .filter((file) => file.endsWith('.html'))
      .map((file) => ({ file, size: statSync(join(dist, dir, file)).size }))
      .sort((a, b) => b.size - a.size || a.file.localeCompare(b.file));
    const largest = candidates[0];
    if (!largest) throw new Error(`budgets.json: no page under /${dir} for ${name}`);
    out[name] = `/${dir}/${largest.file.replace(/\.html$/, '')}`;
  }
  return out;
}

async function serve(site: string, port: number, wrangler: string): Promise<ChildProcess> {
  const child = spawn(
    wrangler,
    ['dev', '--port', String(port), '--ip', '127.0.0.1', '--log-level', 'warn'],
    { cwd: site, stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env } }
  );
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`wrangler dev in ${site} exited`);
    try {
      if ((await fetch(`http://127.0.0.1:${port}/index.txt`)).ok) return child;
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill();
  throw new Error(`wrangler dev in ${site} did not answer within 60 s`);
}

/** Runs Lighthouse CI on every page and returns the median metrics per page (null: not measured). */
function collect(
  lhci: string,
  origin: string,
  paths: Record<string, string>,
  profile: Profile,
  dir: string
): Record<string, Values | null> {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const urls = Object.values(paths).map((path) => `--url=${origin}${path}`);
  execFileSync(
    lhci,
    [
      'collect',
      ...urls,
      `--numberOfRuns=${budgets.lighthouse.runs}`,
      '--settings.onlyCategories=performance',
      '--settings.onlyCategories=accessibility',
      '--settings.onlyCategories=best-practices',
      // As Playwright launches the same Chromium; the pages are the site's own.
      '--settings.chromeFlags=--headless=new --no-sandbox',
      ...(profile === 'desktop' ? ['--settings.preset=desktop'] : []),
    ],
    { cwd: dir, stdio: ['ignore', 'ignore', 'inherit'] }
  );
  const runs = new Map<string, Values[]>();
  let failed = false;
  const results = join(dir, '.lighthouseci');
  for (const file of readdirSync(results).filter((f) => /^lhr-.*\.json$/.test(f))) {
    const lhr = JSON.parse(readFileSync(join(results, file), 'utf8')) as Lhr;
    const values = readLhr(lhr);
    if (!values) failed = true;
    const path = new URL(lhr.requestedUrl).pathname;
    runs.set(path, [...(runs.get(path) ?? []), ...(values ? [values] : [])]);
  }
  const out: Record<string, Values | null> = {};
  for (const [name, path] of Object.entries(paths)) {
    const measured = runs.get(path) ?? [];
    out[name] = measured.length === budgets.lighthouse.runs ? medians(measured) : null;
  }
  if (failed) console.error(`lighthouse: some runs on ${origin} could not measure the page`);
  return out;
}

const pct = (n: number) => String(Math.round(n * 100));

/**
 * The pages the base build has. A page head picks that the base lacks (a new largest post)
 * answers 404 and is left out, so it shows as new; any other answer than 200 or 404 is an error,
 * since Lighthouse CI would fail on it anyway.
 */
async function existing(
  origin: string,
  paths: Record<string, string>
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [name, path] of Object.entries(paths)) {
    const { status } = await fetch(`${origin}${path}`);
    if (status === 200) out[name] = path;
    else if (status !== 404) throw new Error(`${name} (${path}) answered ${status} on the base`);
  }
  return out;
}

async function main() {
  const { values: args } = parseArgs({
    options: {
      base: { type: 'string' },
      head: { type: 'string', default: 'apps/site' },
      profile: { type: 'string', multiple: true, default: [...profiles] },
      out: { type: 'string', default: '.lighthouse/metrics.json' },
    },
  });
  for (const p of args.profile) {
    if (!profiles.includes(p as Profile)) throw new Error(`--profile ${p}: mobile or desktop`);
  }
  if (!process.env.CHROME_PATH) throw new Error('CHROME_PATH is not set; run just lighthouse');
  const head = resolve(args.head);
  const base = args.base ? resolve(args.base) : undefined;
  const bin = (name: string) => join(head, 'node_modules/.bin', name);
  const work = resolve(dirname(args.out));
  const paths = pagePaths(join(head, 'dist'));
  console.log(
    `lighthouse: ${Object.entries(paths)
      .map(([n, p]) => `${n}=${p}`)
      .join(' ')}`
  );

  const servers: ChildProcess[] = [];
  const results: ReturnType<typeof validate>['results'] = [];
  const problems: string[] = [];
  try {
    servers.push(await serve(head, 8791, bin('wrangler')));
    let basePaths: Record<string, string> = {};
    if (base) {
      servers.push(await serve(base, 8792, bin('wrangler')));
      basePaths = await existing('http://127.0.0.1:8792', paths);
      for (const name of Object.keys(paths).filter((n) => !(n in basePaths))) {
        console.log(`lighthouse: ${name} (${paths[name]}) is new: not on the base`);
      }
    }
    for (const profile of args.profile as Profile[]) {
      const headRuns = collect(
        bin('lhci'),
        'http://127.0.0.1:8791',
        paths,
        profile,
        join(work, `head-${profile}`)
      );
      const baseRuns =
        Object.keys(basePaths).length > 0
          ? collect(
              bin('lhci'),
              'http://127.0.0.1:8792',
              basePaths,
              profile,
              join(work, `base-${profile}`)
            )
          : {};
      for (const page of Object.keys(paths)) {
        const h = headRuns[page];
        if (!h) {
          problems.push(
            `${page} (${profile}): Lighthouse could not measure ${paths[page]} on head`
          );
          continue;
        }
        const b = baseRuns[page] ?? null;
        const over = overBudget(h, profile);
        const regressed = regressions(h, b, profile);
        for (const key of over) problems.push(`${page} (${profile}): ${key} ${h[key]} over budget`);
        for (const key of regressed) {
          problems.push(`${page} (${profile}): ${key} regressed from ${b?.[key]} to ${h[key]}`);
        }
        results.push({ page, profile, head: h, base: b, over, regressed });
        console.log(
          `${profile.padEnd(7)} ${page.padEnd(9)} perf ${pct(h.performance)} a11y ${pct(h.accessibility)} bp ${pct(h.bestPractices)} lcp ${h.lcp} ms tbt ${h.tbt} ms cls ${h.cls}`
        );
      }
    }
  } finally {
    for (const server of servers) server.kill();
  }

  if (results.length > 0) {
    const artifact = JSON.stringify({ version: 1, runs: budgets.lighthouse.runs, results });
    // The comment job will refuse anything this check refuses; fail here first.
    validate(artifact);
    mkdirSync(dirname(resolve(args.out)), { recursive: true });
    writeFileSync(args.out, `${artifact}\n`);
    writeFileSync(join(work, 'comment.md'), render(validate(artifact)));
    console.log(`lighthouse: wrote ${args.out}`);
  }
  for (const problem of problems) console.error(`lighthouse: ${problem}`);
  if (problems.length > 0) process.exit(1);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(`lighthouse: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
