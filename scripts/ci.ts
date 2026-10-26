// Decides which CI jobs a change needs (`plan`) and whether the run passed (`gate`). The path
// groups and the job conditions live only here: ci.yml runs a job when the plan says so, and
// the gate requires each job the plan asked for to succeed. ADR 0018 explains the groups.
// Usage:
//   node scripts/ci.ts plan   On a pull request, the files the merge commit changes and the
//                             pull request's labels; on any other GitHub event, everything;
//                             locally, HEAD against origin/main. Writes `plan=<json>`, a boolean
//                             per job, to $GITHUB_OUTPUT (stdout when it is not set).
//   node scripts/ci.ts gate   Reads the `needs` context as JSON from $NEEDS; exits 1 on failure.
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';

// Files every unit is built and tested with. bootstrap.sh installs just (CI, Workers Builds)
// and the CI tools.
const toolchain = [
  'scripts/bootstrap.sh',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  '.node-version',
  'mise.toml',
  'justfile',
  'tsconfig.base.json',
];
// Files only the static checks read.
const checkConfig = ['biome.json', 'knip.jsonc', 'tsconfig.json'];

export const groups = {
  // Site source and config, the contracts both apps use, the repo's own scripts.
  code: ['apps/site/**', 'packages/contracts/**', 'scripts/**', ...toolchain, ...checkConfig],
  signals: ['apps/signals/**', 'packages/contracts/**', ...toolchain, ...checkConfig],
  contracts: ['packages/contracts/**', ...toolchain],
  // Everything that changes the built site, the resume PDF included (site-build compiles it,
  // e2e checks its text).
  output: [
    'apps/site/**',
    'content/**',
    'content/about.*',
    'resume/**',
    'packages/contracts/**',
    'lychee.toml',
    ...toolchain,
  ],
  workflows: ['.github/**', 'scripts/ci.ts', 'scripts/ci-*.ts'],
  // Configs and pins of the CI tools themselves.
  tooling: [
    'renovate.json',
    'scripts/renovate-policy.test.ts',
    '.github/actionlint.yaml',
    '.github/zizmor.yml',
    'scripts/bootstrap.sh',
    'justfile',
  ],
  // What the Lighthouse job runs and measures with (ADR 0017).
  perf: ['scripts/budgets.*', 'scripts/lighthouse*'],
  shell: ['**/*.sh', '.githooks/**'],
  deps: ['**/package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'osv-scanner.toml'],
} as const;

export type Group = keyof typeof groups;
export type Groups = Record<Group, boolean>;

/** A pull request with this label runs Lighthouse whatever it changes. */
export const lighthouseLabel = 'lighthouse';

// Lighthouse measures the site-build artifact, so whatever runs it also builds the site.
const lighthouse = (g: Groups, labels: readonly string[]) =>
  g.output || g.perf || labels.includes(lighthouseLabel);
const siteBuild = (g: Groups, labels: readonly string[]) =>
  g.code || g.output || lighthouse(g, labels);

// Every job in ci.yml except `changes` and `gate`, and when it must run.
export const jobs = {
  format: () => true,
  'secrets-source': () => true,
  checks: (g) => g.code || g.signals,
  contracts: (g) => g.contracts,
  'site-test': (g) => g.code,
  'site-build': siteBuild,
  budgets: siteBuild,
  e2e: (g) => g.code || g.output,
  links: (g) => g.output,
  'signals-test': (g) => g.signals,
  codeql: (g) => g.code || g.signals,
  osv: (g) => g.deps,
  workflows: (g) => g.workflows || g.tooling,
  renovate: (g) => g.tooling,
  shell: (g) => g.shell,
  lighthouse,
} satisfies Record<string, (g: Groups, labels: readonly string[]) => boolean>;

export type Job = keyof typeof jobs;

/**
 * Jobs in ci.yml outside the plan and the gate. `lighthouse-comment` only posts the comment:
 * it follows `lighthouse`, is skipped on forks, and a failure to post must not block a merge.
 */
export const ungated = ['lighthouse-comment'] as const;

/**
 * Whether a path matches a glob: `**` spans any directories, `*` stays within one. Unlike
 * path.matchesGlob, dotfiles match too (`apps/signals/**` covers `.dev.vars.example`).
 */
export function matches(file: string, glob: string): boolean {
  const source = glob
    .split(/(\*\*\/|\/\*\*$|\*)/)
    .map((part) => {
      if (part === '**/') return '(?:.*/)?';
      if (part === '/**') return '/.*';
      if (part === '*') return '[^/]*';
      return part.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('');
  return new RegExp(`^${source}$`).test(file);
}

export function classify(files: readonly string[]): Groups {
  const entries = Object.entries(groups).map(([group, globs]) => [
    group,
    files.some((file) => globs.some((glob) => matches(file, glob))),
  ]);
  return Object.fromEntries(entries) as Groups;
}

export function plan(g: Groups, labels: readonly string[] = []): Record<Job, boolean> {
  const entries = Object.entries(jobs).map(([job, runs]) => [job, runs(g, labels)]);
  return Object.fromEntries(entries) as Record<Job, boolean>;
}

const everything = Object.fromEntries(Object.keys(groups).map((g) => [g, true])) as Groups;

interface Need {
  result: string;
  outputs?: Record<string, string>;
}

/** Problems that fail the gate, given the `needs` context. Empty means the run passed. */
export function gate(needs: Record<string, Need>): string[] {
  const changes = needs.changes;
  if (changes?.result !== 'success') {
    return [`changes: ${changes?.result ?? 'missing from needs'}, so no job can be trusted`];
  }
  let planned: Record<string, unknown>;
  try {
    planned = JSON.parse(changes.outputs?.plan ?? '');
  } catch {
    return ['changes: its plan output is not JSON'];
  }
  const problems: string[] = [];
  for (const job of Object.keys(needs)) {
    if (job !== 'changes' && !(job in jobs)) problems.push(`${job}: not in scripts/ci.ts jobs`);
  }
  for (const job of Object.keys(jobs)) {
    const need = needs[job];
    const runs = planned[job];
    if (!need) problems.push(`${job}: missing from the gate's needs`);
    else if (typeof runs !== 'boolean') {
      problems.push(`${job}: the plan has no decision for it`);
    } else if (runs && need.result !== 'success') {
      problems.push(`${job}: ${need.result}, expected success`);
    } else if (!runs && need.result !== 'skipped') {
      problems.push(`${job}: ${need.result}, but the plan skipped it`);
    }
  }
  return problems;
}

function changedFiles(): readonly string[] | 'all' {
  // NUL-separated paths are never quoted; without rename detection a moved file lists both
  // its old and its new path, so the unit it left is checked too.
  const diff = (...range: string[]) =>
    execFileSync('git', ['diff', '--name-only', '--no-renames', '-z', ...range], {
      encoding: 'utf8',
    })
      .split('\0')
      .filter(Boolean);
  const event = process.env.GITHUB_EVENT_NAME;
  // A pull request checks out its merge commit: parent 1 is the base branch.
  if (event === 'pull_request') return diff('HEAD^1', 'HEAD');
  if (event) return 'all';
  return diff('origin/main...HEAD');
}

/** The pull request's labels, read from the event payload GitHub writes for the run. */
function labels(): string[] {
  const path = process.env.GITHUB_EVENT_PATH;
  if (process.env.GITHUB_EVENT_NAME !== 'pull_request' || !path) return [];
  const event = JSON.parse(readFileSync(path, 'utf8')) as {
    pull_request?: { labels?: { name?: unknown }[] };
  };
  return (event.pull_request?.labels ?? []).flatMap((l) =>
    typeof l.name === 'string' ? [l.name] : []
  );
}

if (import.meta.main) {
  const [command] = process.argv.slice(2);
  if (command === 'plan') {
    const files = changedFiles();
    const g = files === 'all' ? everything : classify(files);
    const prLabels = labels();
    console.error(
      files === 'all'
        ? 'plan: not a pull request, running every job'
        : `plan: ${files.length} changed files`
    );
    console.error(
      `groups: ${Object.entries(g)
        .map(([name, on]) => `${name}=${on}`)
        .join(' ')}`
    );
    console.error(`${lighthouseLabel} label: ${prLabels.includes(lighthouseLabel)}`);
    const line = `plan=${JSON.stringify(plan(g, prLabels))}\n`;
    // In Actions the plan becomes the step's output; locally it is printed.
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, line);
    else process.stdout.write(line);
  } else if (command === 'gate') {
    const needs = JSON.parse(process.env.NEEDS ?? '{}') as Record<string, Need>;
    console.log(`plan: ${needs.changes?.outputs?.plan ?? '-'}`);
    for (const [job, need] of Object.entries(needs)) console.log(`${job}: ${need.result}`);
    const problems = gate(needs);
    for (const problem of problems) console.error(`gate: ${problem}`);
    process.exit(problems.length > 0 ? 1 : 0);
  } else {
    console.error('usage: node scripts/ci.ts plan|gate');
    process.exit(2);
  }
}
