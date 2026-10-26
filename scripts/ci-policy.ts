// Keeps Cloudflare out of GitHub Actions (ADR 0018): CI never deploys and holds no Cloudflare
// credential. Fails when a workflow or action under .github/ calls Wrangler itself or names a
// Cloudflare credential, or when a just recipe a workflow runs (with its dependencies) calls
// any Wrangler command other than the offline ones: `wrangler types` and
// `wrangler deploy --dry-run`.
// Usage: node scripts/ci-policy.ts
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

type Fragment = string | [string, ...unknown[]][];
interface Recipe {
  body: Fragment[][];
  dependencies: { recipe: string }[];
}
interface Dump {
  recipes: Record<string, Recipe>;
  assignments: Record<string, { value: unknown }>;
}

const offline = /\bwrangler (?:types\b|deploy --dry-run\b)/;
const credential = /CLOUDFLARE_|CF_API_|CF_ACCOUNT|wrangler-action/i;

/** Recipe lines as text, with `{{ variable }}` replaced by the variable's value. */
function lines(recipe: Recipe, dump: Dump): string[] {
  return recipe.body.map((line) =>
    line
      .map((fragment) => {
        if (typeof fragment === 'string') return fragment;
        const [[kind, name]] = fragment as [[string, string]];
        const value = kind === 'variable' ? dump.assignments[name]?.value : undefined;
        return typeof value === 'string' ? value : '{{…}}';
      })
      .join('')
  );
}

export function check(root: string): string[] {
  const problems: string[] = [];
  const dump = JSON.parse(
    execFileSync(
      'just',
      ['--justfile', join(root, 'justfile'), '--dump', '--dump-format', 'json'],
      {
        encoding: 'utf8',
      }
    )
  ) as Dump;
  const github = join(root, '.github');
  const called = new Set<string>();
  for (const entry of readdirSync(github, { recursive: true, encoding: 'utf8' })) {
    if (!/\.ya?ml$/.test(entry)) continue;
    const file = relative(root, join(github, entry));
    readFileSync(join(github, entry), 'utf8')
      .split('\n')
      .forEach((text, index) => {
        if (/\bwrangler\b/.test(text))
          problems.push(`${file}:${index + 1}: calls Wrangler directly`);
        if (credential.test(text)) {
          problems.push(`${file}:${index + 1}: names a Cloudflare credential or action`);
        }
        // A command starts a line of a `run:` block, or follows `run:` on the same line.
        const command = /^\s*(?:- )?(?:run:\s*)?just ([a-z][a-z0-9-]*)/.exec(text);
        if (command) called.add(command[1] as string);
      });
  }
  const seen = new Set<string>();
  const visit = (name: string, via: string) => {
    if (seen.has(name)) return;
    seen.add(name);
    const recipe = dump.recipes[name];
    if (!recipe) {
      problems.push(`just ${name} (run by ${via}): not defined in the justfile`);
      return;
    }
    for (const line of lines(recipe, dump)) {
      if (/\bwrangler\b/.test(line) && !offline.test(line)) {
        problems.push(`just ${name} (run by ${via}) calls Wrangler online: ${line.trim()}`);
      }
      if (credential.test(line))
        problems.push(`just ${name} (run by ${via}) names a Cloudflare credential`);
    }
    for (const dependency of recipe.dependencies) visit(dependency.recipe, via);
  };
  for (const name of called) visit(name, `just ${name} in .github`);
  return problems;
}

if (import.meta.main) {
  const problems = check(join(import.meta.dirname, '..'));
  for (const problem of problems) console.error(problem);
  if (problems.length > 0) process.exit(1);
  console.log('ci-policy: no Wrangler or Cloudflare credential in GitHub Actions');
}
