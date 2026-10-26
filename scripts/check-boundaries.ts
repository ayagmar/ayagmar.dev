// Fails when a unit depends on one it must not. The allowed graph:
//   @min7/site -> @min7/contracts <- @min7/signals, and contracts depends on neither app.
// Checks package manifests, tsconfig references and paths, and every import, re-export and
// dynamic import in source (including .astro and .svelte frontmatter, scripts, script sources
// and template expressions), resolved the way TypeScript resolves them so aliases and
// relative paths are caught too.
// Usage: node scripts/check-boundaries.ts [repo-root]
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

interface Unit {
  name: string;
  dir: string;
  allowed: readonly string[];
}

export const units: readonly Unit[] = [
  { name: '@min7/contracts', dir: 'packages/contracts', allowed: [] },
  { name: '@min7/site', dir: 'apps/site', allowed: ['@min7/contracts'] },
  { name: '@min7/signals', dir: 'apps/signals', allowed: ['@min7/contracts'] },
];

const sourceFile = /\.(?:[cm]?[jt]sx?|astro|svelte)$/;
const skippedDirs = new Set([
  'node_modules',
  'dist',
  '.astro',
  '.wrangler',
  'test-results',
  'playwright-report',
]);
const manifestFields = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
];

export function checkBoundaries(rootDir: string): string[] {
  const root = realpathSync(rootDir);
  const absolute = units.map((unit) => ({ ...unit, path: join(root, unit.dir) }));
  const violations: string[] = [];
  const rel = (path: string) => relative(root, path);

  const ownerOf = (path: string) =>
    absolute.find((unit) => path === unit.path || path.startsWith(unit.path + sep));
  const unitNamed = (specifier: string) =>
    absolute.find((unit) => specifier === unit.name || specifier.startsWith(`${unit.name}/`));

  for (const unit of absolute) {
    const forbid = (where: string, what: string) => violations.push(`${where}: ${what}`);
    const checkTarget = (where: string, target: string, how: string) => {
      const owner = ownerOf(target);
      if (owner !== undefined && owner !== unit && !unit.allowed.includes(owner.name)) {
        forbid(where, `${how} ${owner.name}, which ${unit.name} must not depend on`);
      }
    };

    // Manifest: workspace packages by name, and file:/link:/workspace: paths.
    const manifestPath = join(unit.path, 'package.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
    for (const field of manifestFields) {
      const deps = (manifest[field] ?? {}) as Record<string, string>;
      for (const [name, spec] of Object.entries(deps)) {
        const named = unitNamed(name);
        if (named !== undefined && named !== unit && !unit.allowed.includes(named.name)) {
          forbid(
            rel(manifestPath),
            `${field} has ${named.name}, which ${unit.name} must not depend on`
          );
        }
        const path = /^(?:file|link|portal|workspace):(\.{1,2}\/.*)$/.exec(spec)?.[1];
        if (path !== undefined)
          checkTarget(rel(manifestPath), resolve(unit.path, path), `${field}.${name} points into`);
      }
    }

    // Every file in the unit, minus build output and dependencies.
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory() && !skippedDirs.has(entry.name)) walk(join(dir, entry.name));
        else if (entry.isFile()) files.push(join(dir, entry.name));
      }
    };
    walk(unit.path);

    // tsconfig references and path aliases.
    let compilerOptions: ts.CompilerOptions = {
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      allowImportingTsExtensions: true,
    };
    for (const file of files.filter((f) => /(^|[/\\])tsconfig[^/\\]*\.json$/.test(f))) {
      const { config } = ts.readConfigFile(file, ts.sys.readFile);
      const configDir = dirname(file);
      for (const reference of (config?.references ?? []) as { path: string }[]) {
        checkTarget(rel(file), resolve(configDir, reference.path), 'references');
      }
      const paths = (config?.compilerOptions?.paths ?? {}) as Record<string, string[]>;
      const base = resolve(configDir, config?.compilerOptions?.baseUrl ?? '.');
      for (const [alias, targets] of Object.entries(paths)) {
        for (const target of targets) {
          checkTarget(
            rel(file),
            resolve(base, target.replace(/\*.*$/, '')),
            `path alias ${alias} maps into`
          );
        }
      }
      if (file === join(unit.path, 'tsconfig.json')) {
        compilerOptions = {
          ...compilerOptions,
          ...ts.parseJsonConfigFileContent(config, ts.sys, configDir).options,
        };
      }
    }

    // Imports in source.
    for (const file of files.filter((f) => sourceFile.test(f) && !f.endsWith('.d.ts'))) {
      const text = readFileSync(file, 'utf8');
      for (const specifier of specifiersOf(file, text)) {
        const where = rel(file);
        const named = unitNamed(specifier);
        if (named !== undefined) {
          if (named !== unit && !unit.allowed.includes(named.name)) {
            forbid(where, `imports ${specifier}, which ${unit.name} must not depend on`);
          }
          continue;
        }
        const resolved = ts.resolveModuleName(
          specifier,
          file,
          compilerOptions,
          ts.sys
        ).resolvedModule;
        const isPath = /^\.{1,2}(\/|$)|^\//.test(specifier);
        let target: string | undefined;
        if (resolved !== undefined) target = realpathSync(resolved.resolvedFileName);
        else if (isPath) target = resolve(dirname(file), specifier);
        if (target === undefined) continue; // Virtual modules such as astro:content.
        const owner = ownerOf(target);
        if (owner === unit) continue;
        if (owner !== undefined) {
          const how = unit.allowed.includes(owner.name)
            ? `reaches into ${owner.name} by path; import it by package name`
            : `imports ${specifier} from ${owner.name}, which ${unit.name} must not depend on`;
          forbid(where, how);
        } else if (!target.split(sep).includes('node_modules')) {
          forbid(where, `imports ${specifier}, which is outside ${unit.dir}`);
        }
      }
    }
  }
  return violations;
}

const isComponent = (file: string) => file.endsWith('.astro') || file.endsWith('.svelte');

// Template expressions in components can import too ({await import(...)}, {#await import(...)}),
// and TypeScript's scanner cannot read markup, so components also get a conservative textual
// scan. A match in plain prose is a false positive the author can reword.
const componentImports = [
  /\bimport\s*\(\s*(['"`])([^'"`]+)\1/g,
  /\b(?:import|export)\b[^'"`;]*?\bfrom\s*(['"])([^'"]+)\1/g,
  /\bimport\s+(['"])([^'"]+)\1/g,
];
// Root-relative and absolute URLs are public paths, not modules.
const scriptSource = /<script\b[^>]*\bsrc\s*=\s*(['"])(?!\/|[a-z]+:)([^'"]+)\1/gi;

/** Every module specifier a file references. */
function specifiersOf(file: string, text: string): Set<string> {
  const info = ts.preProcessFile(scriptOf(file, text), true, true);
  const found = new Set([...info.importedFiles, ...info.referencedFiles].map((f) => f.fileName));
  if (isComponent(file)) {
    for (const pattern of [...componentImports, scriptSource]) {
      for (const [, , specifier] of text.matchAll(pattern)) if (specifier) found.add(specifier);
    }
  }
  return found;
}

/** The script parts of a component file; other files are all script. */
function scriptOf(file: string, text: string): string {
  const scripts = [...text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(
    ([, body]) => body
  );
  if (file.endsWith('.svelte')) return scripts.join('\n');
  if (file.endsWith('.astro')) {
    const frontmatter = /^\s*---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? '';
    return [frontmatter, ...scripts].join('\n');
  }
  return text;
}

if (import.meta.main) {
  const root = process.argv[2] ?? join(import.meta.dirname, '..');
  if (!existsSync(join(root, 'pnpm-workspace.yaml')))
    throw new Error(`${root} is not the repo root`);
  const violations = checkBoundaries(root);
  for (const violation of violations) console.error(violation);
  if (violations.length > 0) {
    console.error(`\n${violations.length} boundary violation(s). See ARCHITECTURE.md.`);
    process.exit(1);
  }
  console.log('boundaries: ok');
}
