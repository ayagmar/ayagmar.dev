// Lighthouse on the built site (ADR 0017): serves the head build, and the base build when given,
// each through its own Worker with `wrangler dev` (local, offline), runs Lighthouse CI on the
// pages in scripts/budgets.json for each profile, takes the median of the runs, and fails when
// a head page is over budget or regressed against the base beyond the noise allowance. A page
// that looks regressed is measured again, base and head in turn, and the regression stands only
// if it holds on those numbers. Writes the metrics artifact (scripts/lighthouse-report.js has
// its schema) either way.
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
import { freePort } from './free-port.ts';
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

/** Serves a site through `wrangler dev` on a free port; the caller stops the child. */
async function serve(
  site: string,
  wrangler: string
): Promise<{ child: ChildProcess; origin: string }> {
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(
    wrangler,
    ['dev', '--port', String(port), '--ip', '127.0.0.1', '--log-level', 'warn'],
    { cwd: site, stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env } }
  );
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`wrangler dev in ${site} exited`);
    try {
      if ((await fetch(`${origin}/index.txt`)).ok) return { child, origin };
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill();
  throw new Error(`wrangler dev in ${site} did not answer within 60 s`);
}

/** Time allowed for one Lighthouse run of one page, Lighthouse's own 45 s load limit included. */
const runTimeout = 90_000;

/** Why a child process failed, in a few words; its own output is already in the log. */
const failure = (error: unknown) => {
  const e = error as { code?: string; status?: number | null; signal?: string | null };
  if (e.code === 'ETIMEDOUT') return 'timed out';
  if (typeof e.status === 'number') return `exited with ${e.status}`;
  if (e.signal) return `was killed by ${e.signal}`;
  return error instanceof Error ? error.message : String(error);
};

/**
 * Runs Lighthouse CI on every page `runs` times and returns each page's measured runs (fewer
 * than `runs` when Lighthouse could not measure it). Lighthouse sometimes crashes on a page it
 * measures fine the next time (NO_NAVSTART from a gatherer), so a failed `lhci collect` is run
 * once more; a second failure throws, after lhci's own error in the log.
 */
function collect(
  lhci: string,
  origin: string,
  paths: Record<string, string>,
  profile: Profile,
  dir: string,
  runs: number
): Record<string, Values[]> {
  const urls = Object.values(paths).map((path) => `--url=${origin}${path}`);
  const args = [
    'collect',
    ...urls,
    `--numberOfRuns=${runs}`,
    '--settings.onlyCategories=performance',
    '--settings.onlyCategories=accessibility',
    '--settings.onlyCategories=best-practices',
    // As Playwright launches the same Chromium; the pages are the site's own.
    '--settings.chromeFlags=--headless=new --no-sandbox',
    ...(profile === 'desktop' ? ['--settings.preset=desktop'] : []),
  ];
  for (let attempt = 1; ; attempt++) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    try {
      execFileSync(lhci, args, {
        cwd: dir,
        stdio: ['ignore', 'ignore', 'inherit'],
        timeout: runTimeout * urls.length * runs,
      });
      break;
    } catch (error) {
      const what = `lhci collect on ${origin} (${profile}) ${failure(error)}`;
      if (attempt === 2) throw new Error(`${what} again`);
      console.error(`lighthouse: ${what}; running it once more`);
    }
  }
  const measured = new Map<string, Values[]>();
  let failed = false;
  const results = join(dir, '.lighthouseci');
  for (const file of readdirSync(results).filter((f) => /^lhr-.*\.json$/.test(f))) {
    const lhr = JSON.parse(readFileSync(join(results, file), 'utf8')) as Lhr;
    const values = readLhr(lhr);
    if (!values) failed = true;
    const path = new URL(lhr.requestedUrl).pathname;
    measured.set(path, [...(measured.get(path) ?? []), ...(values ? [values] : [])]);
  }
  if (failed) console.error(`lighthouse: some runs on ${origin} could not measure the page`);
  return Object.fromEntries(
    Object.entries(paths).map(([name, path]) => [name, measured.get(path) ?? []])
  );
}

/** The median of each page's runs, or null for a page with fewer runs than asked for. */
const complete = (byPage: Record<string, Values[]>, runs: number) =>
  Object.fromEntries(
    Object.entries(byPage).map(([name, measured]) => [
      name,
      measured.length === runs ? medians(measured) : null,
    ])
  ) as Record<string, Values | null>;

/**
 * Base and head measured again on these pages, one run of each in turn, so both sides see the
 * same runner at the same time: a slow minute slows both. Each side gets as many runs as the
 * first measurement. Throws when a run cannot be measured.
 */
function remeasure(
  lhci: string,
  origins: { base: string; head: string },
  paths: Record<string, string>,
  profile: Profile,
  work: string
): Record<string, { base: Values[]; head: Values[] }> {
  const out: Record<string, { base: Values[]; head: Values[] }> = {};
  for (const name of Object.keys(paths)) out[name] = { base: [], head: [] };
  for (let run = 0; run < budgets.lighthouse.runs; run++) {
    for (const side of ['base', 'head'] as const) {
      const measured = collect(
        lhci,
        origins[side],
        paths,
        profile,
        join(work, `remeasure-${side}-${profile}`),
        1
      );
      for (const [name, values] of Object.entries(measured)) {
        if (values.length !== 1) throw new Error(`Lighthouse could not measure ${name} on ${side}`);
        out[name]?.[side].push(...values);
      }
    }
  }
  return out;
}

/** The regressions that stand on the runs of a re-measure: its base medians against its head's. */
export function confirmed(runs: { base: Values[]; head: Values[] }, profile: Profile): Metric[] {
  return regressions(medians(runs.head), medians(runs.base), profile);
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
  const runs = budgets.lighthouse.runs;
  const problems: string[] = [];
  const baseCache = readCache(args['base-cache']);
  const headCache: Cache = {};
  let baseOrigin: string | undefined;
  try {
    const headServer = await serve(head, bin('wrangler'));
    servers.push(headServer.child);
    const startBase = async () => {
      if (!base) throw new Error('no base build to measure');
      if (!baseOrigin) {
        const baseServer = await serve(base, bin('wrangler'));
        servers.push(baseServer.child);
        baseOrigin = baseServer.origin;
      }
      return baseOrigin;
    };
    for (const profile of args.profile as Profile[]) {
      const headRuns = complete(
        collect(
          bin('lhci'),
          headServer.origin,
          paths,
          profile,
          join(work, `head-${profile}`),
          runs
        ),
        runs
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
        const onBase = await existing(await startBase(), uncached);
        for (const name of Object.keys(uncached).filter((n) => !(n in onBase))) {
          console.log(`lighthouse: ${name} (${paths[name]}) is new: not on the base`);
        }
        if (Object.keys(onBase).length > 0) {
          const measured = complete(
            collect(
              bin('lhci'),
              await startBase(),
              onBase,
              profile,
              join(work, `base-${profile}`),
              runs
            ),
            runs
          );
          for (const [name, values] of Object.entries(measured)) {
            if (values) known[paths[name] as string] = values;
          }
          if (args['base-cache']) writeCache(args['base-cache'], baseCache);
        }
      }
      const rows: ReturnType<typeof validate>['results'] = [];
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
        for (const key of over) problems.push(`${page} (${profile}): ${key} ${h[key]} over budget`);
        rows.push({
          page,
          profile,
          head: h,
          base: b,
          over,
          regressed: regressions(h, b, profile),
          remeasured: null,
        });
        console.log(
          `${profile.padEnd(7)} ${page.padEnd(9)} perf ${pct(h.performance)} a11y ${pct(h.accessibility)} bp ${pct(h.bestPractices)} lcp ${h.lcp} ms tbt ${h.tbt} ms cls ${h.cls}`
        );
      }
      // A base measured on another runner, or minutes earlier, can sit a simulated round trip
      // or two below what this runner reads now. A regression decides only against a base
      // measured beside the head; budgets are absolute and are not measured again.
      const suspects = rows.filter((row) => row.regressed.length > 0);
      if (suspects.length > 0) {
        const names = suspects.map((row) => row.page);
        console.log(
          `lighthouse: measuring ${names.join(', ')} (${profile}) again, base and head in turn`
        );
        try {
          const again = remeasure(
            bin('lhci'),
            { base: await startBase(), head: headServer.origin },
            Object.fromEntries(names.map((name) => [name, paths[name] as string])),
            profile,
            work
          );
          for (const row of suspects) {
            const measured = again[row.page] as { base: Values[]; head: Values[] };
            row.remeasured = { base: medians(measured.base), head: medians(measured.head) };
            row.regressed = confirmed(measured, profile);
            const list = (side: 'base' | 'head', key: Metric) =>
              measured[side].map((v) => Math.round(v[key])).join(' ');
            console.log(
              `lighthouse: ${row.page} (${profile}) re-measured: lcp base ${list('base', 'lcp')}, head ${list('head', 'lcp')}; tbt base ${list('base', 'tbt')}, head ${list('head', 'tbt')}`
            );
          }
        } catch (error) {
          const why = error instanceof Error ? error.message : String(error);
          problems.push(
            `${names.join(', ')} (${profile}): the re-measure failed, so the regression stands: ${why}`
          );
        }
      }
      for (const row of rows) {
        const [b, h] = row.remeasured
          ? [row.remeasured.base, row.remeasured.head]
          : [row.base as Values, row.head];
        const again = row.remeasured ? ', re-measured' : '';
        for (const key of row.regressed) {
          problems.push(
            `${row.page} (${profile}): ${key} regressed from ${b[key]} to ${h[key]}${again}`
          );
        }
      }
      results.push(...rows);
    }
  } finally {
    for (const server of servers) server.kill();
  }
  if (args['head-cache']) writeCache(args['head-cache'], headCache);

  if (results.length > 0) {
    const artifact = JSON.stringify({ version: 2, runs, results });
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
