// Lighthouse on the built site (ADR 0017): serves the head build, and the base build when given,
// each through its own Worker with `wrangler dev` (local, offline), runs Lighthouse CI on the
// pages in scripts/budgets.json for each profile, takes the median of the runs, and fails when
// a head page is over budget or regressed against the base beyond the noise allowance. A page
// that looks regressed is measured again, base and head in turn, and the regression stands only
// if it holds on those numbers; a page over its CLS budget is measured again on head alone. Writes
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
import { freePort } from './free-port.ts';
import { pages as knownPages, metrics, profiles, render, validate } from './lighthouse-report.js';

type Profile = (typeof profiles)[number];
export type Metric = keyof typeof metrics;
type Values = Record<Metric, number>;

const scores = new Set<Metric>(['performance', 'accessibility', 'bestPractices']);
const metricKeys = Object.keys(metrics) as Metric[];

/** The fields of a Lighthouse result this script reads. */
interface LayoutShift {
  score?: number;
  node?: { selector?: string; snippet?: string };
}

interface Lhr {
  requestedUrl: string;
  runtimeError?: { code: string };
  categories: Record<string, { score: number | null }>;
  audits: Record<string, { numericValue?: number; details?: { items?: LayoutShift[] } }>;
}

/**
 * The elements a run saw move, worst first, as `0.0479 main > div.stats-grid`. The report keeps
 * only numbers, so this is the one place a CLS over budget on the runner is explained.
 */
export function shifts(lhr: Lhr): string[] {
  const items = lhr.audits['layout-shifts']?.details?.items ?? [];
  return items.map(
    (item) =>
      `${(item.score ?? 0).toFixed(4)} ${item.node?.selector ?? item.node?.snippet ?? 'an unnamed node'}`
  );
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

/**
 * The URL path of each page; a path ending in `/*` is the largest page directly under it, and
 * is left out while the build has none (no published post, say).
 */
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
    const candidates = (existsSync(join(dist, dir)) ? readdirSync(join(dist, dir)) : [])
      .filter((file) => file.endsWith('.html'))
      .map((file) => ({ file, size: statSync(join(dist, dir, file)).size }))
      .sort((a, b) => b.size - a.size || a.file.localeCompare(b.file));
    const largest = candidates[0];
    if (!largest) {
      console.log(`lighthouse: ${name} left out: the build has no page under /${dir}`);
      continue;
    }
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

/**
 * Time allowed per Lighthouse run of one page, about 11 s in CI. A collect gets two runs more,
 * for lhci's own retries of a failed run: 13 minutes for 24 runs, so a hung collect is killed
 * and run once more inside the job's 35 minutes.
 */
const runTimeout = 30_000;

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
        timeout: runTimeout * (urls.length * runs + 2),
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
    if (values && overBudget(values, profile).includes('cls')) {
      console.log(
        `lighthouse: ${path} (${profile}) moved: ${shifts(lhr).join('; ') || 'nothing named'}`
      );
    }
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

/** The runs of a re-measure of one page; `base` is empty when only head was measured. */
type Remeasured = { base: Values[]; head: Values[] };

/**
 * Head measured again on its pages, and base on its own (a subset), one run of each side in
 * turn, so both sides see the same runner at the same time: a slow minute slows both. Each side
 * gets as many runs as the first measurement. Throws when a run cannot be measured.
 */
function remeasure(
  lhci: string,
  origins: { base: string | undefined; head: string },
  paths: { base: Record<string, string>; head: Record<string, string> },
  profile: Profile,
  work: string
): Record<string, Remeasured> {
  const out: Record<string, Remeasured> = {};
  for (const name of Object.keys(paths.head)) out[name] = { base: [], head: [] };
  for (let run = 0; run < budgets.lighthouse.runs; run++) {
    for (const side of ['base', 'head'] as const) {
      const origin = origins[side];
      if (Object.keys(paths[side]).length === 0) continue;
      if (!origin) throw new Error(`no ${side} server`);
      const measured = collect(
        lhci,
        origin,
        paths[side],
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

/**
 * What stands after a re-measure of a page, from what the first numbers said: regressions on
 * the base's medians against the head's (when the base was measured again), and the CLS budget
 * on the head's median. Every other budget keeps its first verdict.
 */
export function decide(
  first: { over: Metric[]; regressed: Metric[] },
  runs: Remeasured,
  profile: Profile
): { over: Metric[]; regressed: Metric[] } {
  const head = medians(runs.head);
  const stillOver = overBudget(head, profile);
  return {
    over: first.over.filter((key) => key !== 'cls' || stillOver.includes('cls')),
    regressed:
      runs.base.length > 0 ? regressions(head, medians(runs.base), profile) : first.regressed,
  };
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
        rows.push({
          page,
          profile,
          head: h,
          base: b,
          over: overBudget(h, profile),
          regressed: regressions(h, b, profile),
          remeasured: null,
        });
        console.log(
          `${profile.padEnd(7)} ${page.padEnd(9)} perf ${pct(h.performance)} a11y ${pct(h.accessibility)} bp ${pct(h.bestPractices)} lcp ${h.lcp} ms tbt ${h.tbt} ms cls ${h.cls}`
        );
      }
      // A base measured on another runner, or minutes earlier, can sit a simulated round trip
      // or two below what this runner reads now, so a regression decides only against a base
      // measured beside the head. CLS reads a third-decimal shift now and then on an unchanged
      // page, so its budget decides on head measured again. Other budgets are not measured again.
      const regressedRows = rows.filter((row) => row.regressed.length > 0);
      const suspects = rows.filter((row) => row.regressed.length > 0 || row.over.includes('cls'));
      if (suspects.length > 0) {
        const names = suspects.map((row) => row.page);
        const pathsOf = (list: typeof rows) =>
          Object.fromEntries(list.map((row) => [row.page, paths[row.page] as string]));
        console.log(
          `lighthouse: measuring ${names.join(', ')} (${profile}) again, ${regressedRows.length > 0 ? 'base and head in turn' : 'head only'}`
        );
        try {
          const again = remeasure(
            bin('lhci'),
            {
              base: regressedRows.length > 0 ? await startBase() : undefined,
              head: headServer.origin,
            },
            { base: pathsOf(regressedRows), head: pathsOf(suspects) },
            profile,
            work
          );
          for (const row of suspects) {
            const measured = again[row.page] as Remeasured;
            Object.assign(row, decide(row, measured, profile));
            row.remeasured = {
              base: measured.base.length > 0 ? medians(measured.base) : null,
              head: medians(measured.head),
            };
            const list = (side: 'base' | 'head') =>
              measured[side].length === 0
                ? ''
                : ` ${side} lcp ${measured[side].map((v) => Math.round(v.lcp)).join(' ')}, tbt ${measured[side].map((v) => Math.round(v.tbt)).join(' ')}, cls ${measured[side].map((v) => v.cls.toFixed(4)).join(' ')};`;
            console.log(
              `lighthouse: ${row.page} (${profile}) re-measured:${list('base')}${list('head')}`
            );
          }
        } catch (error) {
          const why = error instanceof Error ? error.message : String(error);
          problems.push(
            `${names.join(', ')} (${profile}): the re-measure failed, so the first numbers stand: ${why}`
          );
        }
      }
      for (const row of rows) {
        const again = row.remeasured;
        for (const key of row.over) {
          const [value, note] =
            key === 'cls' && again ? [again.head.cls, ', re-measured'] : [row.head[key], ''];
          problems.push(`${row.page} (${profile}): ${key} ${value} over budget${note}`);
        }
        const [b, h] = again?.base ? [again.base, again.head] : [row.base as Values, row.head];
        for (const key of row.regressed) {
          problems.push(
            `${row.page} (${profile}): ${key} regressed from ${b[key]} to ${h[key]}${again?.base ? ', re-measured' : ''}`
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
