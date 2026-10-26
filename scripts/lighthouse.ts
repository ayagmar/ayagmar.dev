// Lighthouse on the built site (ADR 0017): serves the head build, and the base build when given,
// each through its own Worker with `wrangler dev` (local, offline), runs Lighthouse CI on the
// pages in scripts/budgets.json for each profile, takes the median of the runs, and fails when
// a head page is over budget or regressed against the base beyond the noise allowance. Writes
// the metrics artifact (scripts/lighthouse-report.js has its schema) either way.
// Chromium comes from CHROME_PATH (`just lighthouse` sets it to Playwright's).
// A base cache file holds the base's medians by URL path, so a base measured once (CI keys the
// file by the base commit) is not measured again; the base is served only for pages the cache
// lacks. A head cache file receives the head's medians in the same format, for CI to keep under
// the commit it measured.
// Usage: node scripts/lighthouse.ts [--base <site dir>] [--head <site dir>]
//          [--profile mobile|desktop]... [--out <metrics.json>]
//          [--base-cache <file>] [--head-cache <file>]
// A site dir is apps/site of a checkout, built: wrangler.jsonc, worker/ and dist/.
import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
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

/** Medians by profile and URL path, the format of the cache files. */
export type Cache = Partial<Record<Profile, Record<string, Values>>>;

/**
 * The cache file's content. A file that is missing or not a cache this script wrote counts as
 * empty, so a bad cache costs a measurement and never a failed run.
 */
export function readCache(file: string | undefined): Cache {
  if (!file || !existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as {
      version?: unknown;
      profiles?: unknown;
    };
    if (parsed.version !== 1 || typeof parsed.profiles !== 'object' || parsed.profiles === null) {
      throw new Error('not a version 1 cache');
    }
    const out: Cache = {};
    for (const profile of profiles) {
      const byPath = (parsed.profiles as Record<string, unknown>)[profile] ?? {};
      if (typeof byPath !== 'object' || byPath === null)
        throw new Error(`${profile}: not an object`);
      const entries: Record<string, Values> = {};
      for (const [path, value] of Object.entries(byPath)) {
        const v = value as Record<string, unknown>;
        if (!metricKeys.every((key) => typeof v[key] === 'number' && Number.isFinite(v[key]))) {
          throw new Error(`${profile} ${path}: not six numbers`);
        }
        entries[path] = Object.fromEntries(metricKeys.map((key) => [key, v[key]])) as Values;
      }
      out[profile] = entries;
    }
    return out;
  } catch (error) {
    console.error(
      `lighthouse: ignoring the cache ${file}: ${error instanceof Error ? error.message : String(error)}`
    );
    return {};
  }
}

function writeCache(file: string, cache: Cache) {
  mkdirSync(dirname(resolve(file)), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ version: 1, profiles: cache })}\n`);
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
      'base-cache': { type: 'string' },
      'head-cache': { type: 'string' },
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
  const baseCache = readCache(args['base-cache']);
  const headCache: Cache = {};
  const baseOrigin = 'http://127.0.0.1:8792';
  try {
    servers.push(await serve(head, 8791, bin('wrangler')));
    let baseUp = false;
    for (const profile of args.profile as Profile[]) {
      const headRuns = collect(
        bin('lhci'),
        'http://127.0.0.1:8791',
        paths,
        profile,
        join(work, `head-${profile}`)
      );
      // The base is measured only for pages its cache lacks, and only if it has them.
      const known = baseCache[profile] ?? {};
      baseCache[profile] = known;
      const headByPath: Record<string, Values> = {};
      headCache[profile] = headByPath;
      const uncached = Object.fromEntries(
        Object.entries(paths).filter(([, path]) => !(path in known))
      );
      if (base && Object.keys(uncached).length > 0) {
        if (!baseUp) servers.push(await serve(base, 8792, bin('wrangler')));
        baseUp = true;
        const onBase = await existing(baseOrigin, uncached);
        for (const name of Object.keys(uncached).filter((n) => !(n in onBase))) {
          console.log(`lighthouse: ${name} (${paths[name]}) is new: not on the base`);
        }
        if (Object.keys(onBase).length > 0) {
          const measured = collect(
            bin('lhci'),
            baseOrigin,
            onBase,
            profile,
            join(work, `base-${profile}`)
          );
          for (const [name, values] of Object.entries(measured)) {
            if (values) known[paths[name] as string] = values;
          }
          if (args['base-cache']) writeCache(args['base-cache'], baseCache);
        }
      }
      for (const page of Object.keys(paths)) {
        const h = headRuns[page];
        if (!h) {
          problems.push(
            `${page} (${profile}): Lighthouse could not measure ${paths[page]} on head`
          );
          continue;
        }
        headByPath[paths[page] as string] = h;
        const b = known[paths[page] as string] ?? null;
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
  if (args['head-cache']) writeCache(args['head-cache'], headCache);

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
