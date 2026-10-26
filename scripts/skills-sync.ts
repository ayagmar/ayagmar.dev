// Writes content/skills.json: an allowlisted extract of the public skills repo, so the site build
// needs neither the network nor a checkout (ADR 0031).
// Usage: node scripts/skills-sync.ts [--from <repo>] [--evals <dir>] [--out <file>]
//   --from   a checkout to read; default: a shallow clone of the repo's main branch
//   --evals  the eval-results directory; default: <from>/eval-results when it exists. The repo
//            does not track eval results, so with the default clone pass the local ones.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { localPath, publicModels, semver } from '../apps/site/src/lib/skills-public.ts';
import { rules } from './scan-secrets.ts';

export const repo = 'ayagmar/agents-skills';
const blobBase = `https://github.com/${repo}/blob/main/`;

/** One skill as the site shows it. Every field is copied from the source by name. */
export interface SkillEntry {
  name: string;
  summary: string;
  version: string;
  package: string;
  license: string;
  runtime: string | null;
  install: string | null;
  credit: string | null;
  readme: string;
  npm: string;
  eval: {
    passed: number;
    total: number;
    threshold: number;
    /** `YYYY-MM-DD` the suite started. */
    date: string;
    model: string;
    /** The skill version the suite ran against, which may be older than `version`. */
    version: string;
  } | null;
}

export interface SkillsFile {
  source: { repo: string; commit: string; committedAt: string };
  skills: SkillEntry[];
}

export interface SyncResult {
  file: SkillsFile;
  warnings: string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** A file of the commit, or null when the commit has none; the working tree is never read. */
function show(repoDir: string, commit: string, path: string): string | null {
  try {
    return execFileSync('git', ['show', `${commit}:${path}`], {
      cwd: repoDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

/** The entries of a directory of the commit, or none when it has no such directory. */
function entries(repoDir: string, commit: string, dir: string): string[] {
  try {
    return git(repoDir, 'ls-tree', '--name-only', `${commit}:${dir}`).split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

const needFile = (content: string | null, path: string) => {
  if (content === null) throw new Error(`${path} is not in the commit`);
  return content;
};

function frontmatter(source: string): Record<string, unknown> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
  const data: unknown = match?.[1] === undefined ? null : parseYaml(match[1]);
  if (!isRecord(data)) throw new Error('has no YAML frontmatter');
  return data;
}

interface Row {
  summary: string | null;
  runtime: string | null;
}

/** The README's skills table by plugin directory: purpose and runtime. */
function readmeRows(readme: string): Map<string, Row> {
  const rows = new Map<string, Row>();
  const lines = readme.split('\n').filter((line) => line.startsWith('|'));
  const cells = (line: string) =>
    line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
  const header = lines[0] === undefined ? [] : cells(lines[0]).map((cell) => cell.toLowerCase());
  const runtime = header.indexOf('runtime');
  const purpose = header.indexOf('purpose');
  if (runtime < 0 || purpose < 0) return rows;
  for (const line of lines.slice(2)) {
    const row = cells(line);
    const dir = /\(plugins\/([^/)]+)\/README\.md\)/.exec(row[0] ?? '')?.[1];
    if (dir === undefined) continue;
    rows.set(dir, {
      runtime: text(row[runtime]?.replaceAll('`', '')),
      summary: text(row[purpose]),
    });
  }
  return rows;
}

/** The first paragraph of a README's Credits section, links reduced to their text. */
function readmeCredit(readme: string): string | null {
  const section = /^## Credits\s*\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(readme)?.[1];
  const paragraph = section?.trim().split(/\n\s*\n/)[0];
  return text(paragraph?.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\s*\n\s*/g, ' '));
}

function evaluation(dir: string, name: string): { value: SkillEntry['eval']; warning?: string } {
  const path = join(dir, name, 'aggregate-result.json');
  if (!existsSync(path)) return { value: null };
  const data = readJson(path);
  const suite = isRecord(data) && isRecord(data.suite) ? data.suite : null;
  const totals = isRecord(data) && isRecord(data.aggregates) ? data.aggregates : null;
  const plugin =
    suite !== null && Array.isArray(suite.plugins)
      ? suite.plugins.find((entry) => isRecord(entry) && entry.name === name)
      : undefined;
  const startedAt = isRecord(data) ? text(data.startedAt) : null;
  const passed = totals?.casesPassed;
  const total = totals?.casesTotal;
  const threshold = suite?.threshold;
  const model = text(suite?.modelOverride);
  const version = isRecord(plugin) ? text(plugin.version) : null;
  if (
    !Number.isInteger(passed) ||
    !Number.isInteger(total) ||
    typeof passed !== 'number' ||
    typeof total !== 'number' ||
    total < 1 ||
    passed < 0 ||
    passed > total ||
    typeof threshold !== 'number' ||
    !(threshold > 0 && threshold <= 1) ||
    startedAt === null ||
    Number.isNaN(Date.parse(startedAt)) ||
    model === null ||
    !(publicModels as readonly string[]).includes(model) ||
    version === null ||
    !semver.test(version)
  ) {
    throw new Error(`${path} is not an aggregate result with this skill's cases and suite`);
  }
  if (isRecord(data) && data.partial === true) {
    return { value: null, warning: `${name}: the eval run is partial, so it is left out` };
  }
  return {
    value: {
      passed,
      total,
      threshold,
      date: new Date(startedAt).toISOString().slice(0, 10),
      model,
      version,
    },
  };
}

/** Fails on anything the site must not publish: a local path, an address or a secret shape. */
export function leaks(content: string): string[] {
  const found: string[] = [];
  const patterns: [string, RegExp][] = [
    ['a /home path', /\/home\//],
    ['a /Users path', /\/Users\//],
    ['a ~/. path', /~\/\./],
    ['an email address', /[\w.+-]+@[\w-]+\.[\w.-]+/],
  ];
  for (const [what, pattern] of patterns) if (pattern.test(content)) found.push(what);
  // Decoded values, so an escaped backslash or slash in JSON is the character it stands for.
  const decoded = (value: unknown): string[] =>
    typeof value === 'string'
      ? [value]
      : typeof value === 'object' && value !== null
        ? Object.values(value).flatMap(decoded)
        : [];
  let values = [content];
  try {
    values = decoded(JSON.parse(content));
  } catch {}
  for (const value of values) {
    const kind = localPath(value);
    if (kind !== null && !found.includes(kind)) found.push(kind);
  }
  for (const rule of rules) {
    const hit = [...content.matchAll(rule.pattern)].some(
      (match) => !rule.accept || rule.accept(match[1] ?? match[0])
    );
    if (hit) found.push(`a secret shaped like ${rule.id}`);
  }
  return found;
}

export function extractSkills(repoDir: string, evalsDir: string | null): SyncResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  // Everything below is read from this commit's tree, so edits and untracked files in a checkout
  // cannot enter a snapshot that names the commit.
  const [commit = '', committed = ''] = git(repoDir, 'log', '-1', '--format=%H %ct', 'HEAD').split(
    ' '
  );
  const rows = readmeRows(needFile(show(repoDir, commit, 'README.md'), 'README.md'));
  const skills: SkillEntry[] = [];

  const plugins = entries(repoDir, commit, 'plugins').sort((a, b) => a.localeCompare(b));
  // The README lists the skills in a deliberate order; plugins it does not list follow.
  const listed = [...rows.keys()].filter((dir) => plugins.includes(dir));
  const ordered = [...listed, ...plugins.filter((dir) => !listed.includes(dir))];

  for (const dir of ordered) {
    const base = `plugins/${dir}`;
    const file = (path: string) =>
      needFile(show(repoDir, commit, `${base}/${path}`), `${base}/${path}`);
    try {
      const manifest: unknown = JSON.parse(file('package.json'));
      if (!isRecord(manifest)) throw new Error('package.json is not an object');
      const skillDirs = entries(repoDir, commit, `${base}/skills`);
      if (skillDirs.length !== 1) throw new Error(`has ${skillDirs.length} skills, expected one`);
      const meta = frontmatter(file(`skills/${skillDirs[0] ?? ''}/SKILL.md`));
      const name = text(meta.name);
      const pkg = text(manifest.name);
      const version = text(manifest.version);
      const license = text(manifest.license);
      if (name === null || pkg === null || version === null || license === null) {
        throw new Error('needs a name, a package name, a version and a license');
      }
      if (!semver.test(version)) throw new Error('version is not SemVer');
      if (pkg !== `@ayagmar/${name}`) throw new Error(`package ${pkg} is not @ayagmar/${name}`);
      const readmeText = file('README.md');

      const row = rows.get(dir);
      const summary = row?.summary ?? text(manifest.description);
      if (summary === null) throw new Error('has no README table row and no package description');
      if (row === undefined) {
        warnings.push(`${name}: no row in the README table; summary from package.json`);
      }
      const sources = isRecord(meta.metadata) ? text(meta.metadata.sources) : null;
      const installLine = readmeText
        .split('\n')
        .find((line) => line.startsWith(`npx skills add ${repo} --skill ${name} `));
      const evaluated = evalsDir === null ? { value: null } : evaluation(evalsDir, name);
      if ('warning' in evaluated && evaluated.warning !== undefined) {
        warnings.push(evaluated.warning);
      }

      skills.push({
        name,
        summary,
        version,
        package: pkg,
        license,
        runtime: row?.runtime ?? null,
        install: installLine?.trim() ?? null,
        credit: sources ?? readmeCredit(readmeText),
        readme: `${blobBase}plugins/${dir}/README.md`,
        npm: `https://www.npmjs.com/package/${pkg}`,
        eval: evaluated.value,
      });
    } catch (error) {
      errors.push(`plugins/${dir}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const committedAt = new Date(Number(committed) * 1000).toISOString();
  if (!/^[0-9a-f]{40}$/.test(commit)) errors.push(`${repoDir} has no commit`);
  if (skills.length === 0 && errors.length === 0) errors.push('no skills found under plugins/');
  const file: SkillsFile = { source: { repo, commit, committedAt }, skills };
  const problems = leaks(JSON.stringify(file));
  if (problems.length > 0) errors.push(`the output contains ${problems.join(', ')}`);
  if (errors.length > 0) throw new Error(errors.join('\n'));
  return { file, warnings };
}

export const render = (file: SkillsFile) => `${JSON.stringify(file, null, 2)}\n`;

function main(argv: string[]) {
  const option = (flag: string) => {
    const at = argv.indexOf(flag);
    return at < 0 ? undefined : argv[at + 1];
  };
  const out = resolve(option('--out') ?? join(import.meta.dirname, '..', 'content', 'skills.json'));
  let clone: string | null = null;
  try {
    let from = option('--from');
    if (from === undefined) {
      const cache = process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache');
      clone = mkdtempSync(join(cache, 'min7-skills-sync-'));
      execFileSync('git', [
        'clone',
        '--depth',
        '1',
        '--branch',
        'main',
        '--quiet',
        `https://github.com/${repo}`,
        clone,
      ]);
      from = clone;
    }
    const fromDir = resolve(from);
    const defaultEvals = join(fromDir, 'eval-results');
    const evals = option('--evals') ?? (existsSync(defaultEvals) ? defaultEvals : null);
    const { file, warnings } = extractSkills(fromDir, evals === null ? null : resolve(evals));
    for (const warning of warnings) console.warn(`warning: ${warning}`);
    writeFileSync(out, render(file));
    const evaluated = file.skills.filter((skill) => skill.eval !== null).length;
    console.log(
      `skills-sync: ${file.skills.length} skills (${evaluated} with evals) at ${file.source.commit.slice(0, 7)} -> ${out}`
    );
  } catch (error) {
    console.error(`skills-sync: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  } finally {
    if (clone !== null) rmSync(clone, { recursive: true, force: true });
  }
}

if (import.meta.main) main(process.argv.slice(2));
