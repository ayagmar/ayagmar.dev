// The Lighthouse metrics artifact (ADR 0017): its schema, the strict validator, and the
// markdown of the sticky pull request comment. scripts/lighthouse.ts writes the artifact in
// the read-only `lighthouse` job; the `lighthouse-comment` job, which holds the only write
// token and never checks out code, runs a copy of this file embedded in ci.yml on the
// downloaded artifact. Plain JavaScript with Node built-ins only, so the runner's own Node runs
// it; a test in scripts/lighthouse-report.test.ts fails when that copy differs from this file.
// The artifact came from a job that ran the pull request's code: nothing from it reaches the
// comment or the log except numbers that passed the checks below. Page and metric names are
// rendered from the tables here, never from the artifact.
// Usage: node scripts/lighthouse-report.js render <metrics.json>... <comment.md>
// One artifact per profile job; the comment merges them.
import { readFileSync, statSync, writeFileSync } from 'node:fs';

export const marker = '<!-- min7-lighthouse -->';
export const version = 2;
/** Larger artifacts are refused unread. The real one is about 4 KB, 6 KB with every page re-measured. */
export const maxBytes = 16_384;

/** @type {Readonly<Record<string, string>>} Page names in the artifact, and their labels. */
export const pages = {
  home: 'Home',
  post: 'A post',
  writing: 'Writing',
  projects: 'Projects',
  project: 'A project',
  about: 'About',
  stats: 'Stats',
  uses: 'Uses',
};
export const profiles = /** @type {const} */ (['mobile', 'desktop']);

/**
 * @typedef {'performance' | 'accessibility' | 'bestPractices' | 'lcp' | 'tbt' | 'cls'} Metric
 * @typedef {Record<Metric, number>} Values
 * @typedef {{ page: string, profile: 'mobile' | 'desktop', head: Values, base: Values | null,
 *   over: Metric[], regressed: Metric[], remeasured: { base: Values | null, head: Values } | null }} Result
 * `remeasured`: the page looked regressed against `base`, so base and head were measured again in
 * turn on the same runner, and `regressed` is decided on those numbers; or its CLS or TBT was
 * over budget, so head was measured again (base only if it also looked regressed), and those
 * entries in `over` are decided on that head.
 * @typedef {{ version: 2, runs: number, results: Result[] }} Metrics
 */

/** @type {Readonly<Record<Metric, { label: string, max: number, format: (n: number) => string }>>} */
export const metrics = {
  performance: { label: 'Performance', max: 1, format: (n) => String(Math.round(n * 100)) },
  accessibility: { label: 'Accessibility', max: 1, format: (n) => String(Math.round(n * 100)) },
  bestPractices: { label: 'Best practices', max: 1, format: (n) => String(Math.round(n * 100)) },
  lcp: { label: 'LCP', max: 120_000, format: (n) => `${(n / 1000).toFixed(2)} s` },
  tbt: { label: 'TBT', max: 120_000, format: (n) => `${Math.round(n)} ms` },
  cls: { label: 'CLS', max: 10, format: (n) => n.toFixed(3) },
};
const metricKeys = /** @type {Metric[]} */ (Object.keys(metrics));

/**
 * The budgets whose miss is measured again on head and decided on that median (ADR 0017): both
 * read noise around their limits on unchanged pages. Every other budget is decided on the first.
 * @type {readonly Metric[]}
 */
export const remeasuredBudgets = ['cls', 'tbt'];

/** @param {unknown} value */
const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * @param {unknown} value
 * @param {readonly string[]} keys
 * @param {string} where
 * @returns {Record<string, unknown>}
 */
function exactObject(value, keys, where) {
  if (!isObject(value)) throw new Error(`${where}: not an object`);
  const object = /** @type {Record<string, unknown>} */ (value);
  const own = Object.keys(object);
  if (own.length !== keys.length || !keys.every((key) => Object.hasOwn(object, key))) {
    throw new Error(`${where}: fields are not exactly ${keys.join(', ')}`);
  }
  return object;
}

/**
 * @param {unknown} value
 * @param {string} where
 * @returns {Values}
 */
function values(value, where) {
  const object = exactObject(value, metricKeys, where);
  /** @type {Partial<Values>} */
  const out = {};
  for (const key of metricKeys) {
    const n = object[key];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > metrics[key].max) {
      throw new Error(`${where}.${key}: not a number from 0 to ${metrics[key].max}`);
    }
    out[key] = n;
  }
  return /** @type {Values} */ (out);
}

/**
 * @param {unknown} value
 * @param {string} where
 * @returns {Metric[]}
 */
function metricList(value, where) {
  if (!Array.isArray(value) || value.length > metricKeys.length) {
    throw new Error(`${where}: not a list of metrics`);
  }
  const list = /** @type {unknown[]} */ (value);
  if (!list.every((m) => metricKeys.includes(/** @type {Metric} */ (m)))) {
    throw new Error(`${where}: names an unknown metric`);
  }
  if (new Set(list).size !== list.length) throw new Error(`${where}: repeats a metric`);
  return /** @type {Metric[]} */ (list.slice());
}

/**
 * @param {unknown} value
 * @param {string} where
 * @returns {{ base: Values | null, head: Values }}
 */
function remeasured(value, where) {
  const object = exactObject(value, ['base', 'head'], where);
  return {
    base: object.base === null ? null : values(object.base, `${where}.base`),
    head: values(object.head, `${where}.head`),
  };
}

/**
 * Parses and checks an artifact. Returns a fresh copy holding only the known fields; throws
 * with a message that never repeats the artifact's content.
 * @param {string} text
 * @returns {Metrics}
 */
export function validate(text) {
  if (Buffer.byteLength(text) > maxBytes) throw new Error(`artifact: over ${maxBytes} bytes`);
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('artifact: not JSON');
  }
  const top = exactObject(parsed, ['version', 'runs', 'results'], 'artifact');
  if (top.version !== version) throw new Error(`artifact.version: not ${version}`);
  const runs = top.runs;
  if (typeof runs !== 'number' || !Number.isInteger(runs) || runs < 1 || runs > 9) {
    throw new Error('artifact.runs: not a whole number from 1 to 9');
  }
  const limit = Object.keys(pages).length * profiles.length;
  if (!Array.isArray(top.results) || top.results.length < 1 || top.results.length > limit) {
    throw new Error(`artifact.results: not a list of 1 to ${limit} results`);
  }
  const seen = new Set();
  const results = /** @type {unknown[]} */ (top.results).map((item, i) => {
    const where = `artifact.results[${i}]`;
    const r = exactObject(
      item,
      ['page', 'profile', 'head', 'base', 'over', 'regressed', 'remeasured'],
      where
    );
    const page = r.page;
    if (typeof page !== 'string' || !Object.hasOwn(pages, page)) {
      throw new Error(`${where}.page: not a known page`);
    }
    const profile = /** @type {'mobile' | 'desktop'} */ (r.profile);
    if (!profiles.includes(profile)) throw new Error(`${where}.profile: not mobile or desktop`);
    if (seen.has(`${page} ${profile}`)) throw new Error(`${where}: repeats a page and profile`);
    seen.add(`${page} ${profile}`);
    return {
      page,
      profile,
      head: values(r.head, `${where}.head`),
      base: r.base === null ? null : values(r.base, `${where}.base`),
      over: metricList(r.over, `${where}.over`),
      regressed: metricList(r.regressed, `${where}.regressed`),
      remeasured: r.remeasured === null ? null : remeasured(r.remeasured, `${where}.remeasured`),
    };
  });
  return { version, runs, results };
}

/**
 * The artifacts of the profile jobs as one. They must agree on the number of runs and not repeat
 * a page and profile; there is at most one per profile.
 * @param {Metrics[]} parts
 * @returns {Metrics}
 */
export function merge(parts) {
  const first = parts[0];
  if (!first || parts.length > profiles.length) {
    throw new Error(`artifacts: not 1 to ${profiles.length} files`);
  }
  if (parts.some((part) => part.runs !== first.runs)) throw new Error('artifacts: runs differ');
  const results = parts.flatMap((part) => part.results);
  const keys = new Set(results.map((r) => `${r.page} ${r.profile}`));
  if (keys.size !== results.length) throw new Error('artifacts: repeat a page and profile');
  return { version, runs: first.runs, results };
}

/**
 * The comment body: one table per profile, base → head for each metric and page.
 * @param {Metrics} m
 * @returns {string}
 */
export function render(m) {
  const failing = m.results.filter((r) => r.over.length > 0 || r.regressed.length > 0).length;
  const missing = profiles.filter((p) => !m.results.some((r) => r.profile === p));
  /** One paragraph per thing wrong; the all-clear only when nothing is wrong or missing. */
  const summary = [
    ...(missing.length > 0
      ? [
          `Incomplete: no metrics from the ${missing.join(' and ')} ${missing.length === 1 ? 'job' : 'jobs'}, which failed before measuring. The \`lighthouse\` job fails.`,
        ]
      : []),
    ...(failing > 0
      ? [
          `${failing} page and profile ${failing === 1 ? 'combination fails' : 'combinations fail'}: ✗ over budget, ▲ regressed against the base. The \`lighthouse\` job fails.`,
        ]
      : []),
  ];
  if (summary.length === 0) summary.push('Every page is within budget and no metric regressed.');
  const lines = [
    marker,
    '## Lighthouse',
    '',
    ...summary.flatMap((paragraph) => [paragraph, '']),
    `Base → head, median of ${m.runs} ${m.runs === 1 ? 'run' : 'runs'} with simulated throttling, both built in fixtures mode. Budgets: ADR 0017.`,
    ...(m.results.some((r) => r.remeasured)
      ? [
          '',
          'A page that looked regressed, or was over its CLS or TBT budget, has a second row, _re-measured_: measured again on the same runner, base and head one run of each in turn (head alone for a budget). That row decides the regression and the CLS and TBT budgets; the other budgets are judged on the first.',
        ]
      : []),
  ];
  for (const profile of profiles) {
    const rows = m.results.filter((r) => r.profile === profile);
    if (rows.length === 0) continue;
    lines.push(
      '',
      `### ${profile === 'mobile' ? 'Mobile' : 'Desktop'}`,
      '',
      `| Page | ${metricKeys.map((k) => metrics[k].label).join(' | ')} |`,
      `| --- | ${metricKeys.map(() => '---').join(' | ')} |`
    );
    const order = Object.keys(pages);
    rows.sort((a, b) => order.indexOf(a.page) - order.indexOf(b.page));
    for (const r of rows) {
      const again = r.remeasured;
      /**
       * Each mark on the row whose numbers decided it: a regression on the re-measured row when
       * the base was measured again, the CLS and TBT budgets there when the page was, the rest on
       * the first.
       * @param {Metric} k
       * @param {boolean} remeasuredRow
       */
      const flags = (k, remeasuredRow) => {
        const over =
          r.over.includes(k) && (remeasuredBudgets.includes(k) && !!again) === remeasuredRow;
        const regressed = r.regressed.includes(k) && !!again?.base === remeasuredRow;
        return `${over ? ' ✗' : ''}${regressed ? ' ▲' : ''}`;
      };
      const cells = metricKeys.map((k) => {
        const { format } = metrics[k];
        const base = r.base === null ? 'new' : format(r.base[k]);
        return `${base} → ${format(r.head[k])}${flags(k, false)}`;
      });
      lines.push(`| ${pages[r.page]} | ${cells.join(' | ')} |`);
      if (!again) continue;
      const remeasuredCells = metricKeys.map((k) => {
        const { format } = metrics[k];
        const head = format(again.head[k]);
        const cell = again.base ? `${format(again.base[k])} → ${head}` : head;
        return `${cell}${flags(k, true)}`;
      });
      lines.push(`| ${pages[r.page]}, re-measured | ${remeasuredCells.join(' | ')} |`);
    }
  }
  return `${lines.join('\n')}\n`;
}

if (process.argv[2] === 'render') {
  const files = process.argv.slice(3);
  const output = files.pop() ?? '';
  try {
    // Refuse an oversized file before reading it.
    for (const input of files) {
      if (statSync(input).size > maxBytes) throw new Error(`artifact: over ${maxBytes} bytes`);
    }
    const parts = files.map((input) => validate(readFileSync(input, 'utf8')));
    writeFileSync(output, render(merge(parts)));
    console.log('lighthouse-report: artifact valid, comment rendered');
  } catch (error) {
    console.error(`lighthouse-report: ${error instanceof Error ? error.message : 'failed'}`);
    process.exit(1);
  }
}
