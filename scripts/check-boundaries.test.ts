import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { checkBoundaries } from './check-boundaries.ts';

// A minimal workspace with the allowed graph; each case adds one forbidden edge.
const allowed: Record<string, string> = {
  'pnpm-workspace.yaml': 'packages: [apps/*, packages/*]\n',
  'packages/contracts/package.json': JSON.stringify({
    name: '@min7/contracts',
    exports: { '.': './src/index.ts' },
  }),
  'packages/contracts/tsconfig.json': '{ "compilerOptions": { "composite": true } }',
  'packages/contracts/src/index.ts': 'export const contract = 1;\n',
  'apps/site/package.json': JSON.stringify({
    name: '@min7/site',
    dependencies: { '@min7/contracts': 'workspace:*' },
  }),
  'apps/site/tsconfig.json': '{ "references": [{ "path": "../../packages/contracts" }] }',
  'apps/site/src/page.ts': "import { contract } from '@min7/contracts';\nexport { contract };\n",
  'apps/site/src/globs.ts': "export const own = import.meta.glob(['./*.ts', '/src/*.astro']);\n",
  'apps/site/src/Page.astro':
    "---\nimport { contract } from '@min7/contracts';\n---\n<p>{contract}</p>\n",
  'apps/signals/package.json': JSON.stringify({
    name: '@min7/signals',
    dependencies: { '@min7/contracts': 'workspace:*' },
  }),
  'apps/signals/tsconfig.json': '{ "references": [{ "path": "../../packages/contracts" }] }',
  'apps/signals/src/index.ts': "export * from '@min7/contracts';\nexport * from './local.ts';\n",
  'apps/signals/src/local.ts': 'export const local = 1;\n',
};

let root: string;

const defaultLinks = {
  contracts: 'packages/contracts',
  site: 'apps/site',
  signals: 'apps/signals',
};

function workspace(changes: Record<string, string>, links: Partial<typeof defaultLinks> = {}) {
  for (const [path, content] of Object.entries({ ...allowed, ...changes })) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  // pnpm links workspace packages into node_modules; resolution follows the links.
  mkdirSync(join(root, 'node_modules/@min7'), { recursive: true });
  for (const [name, dir] of Object.entries({ ...defaultLinks, ...links })) {
    symlinkSync(join(root, dir), join(root, 'node_modules/@min7', name));
  }
  return checkBoundaries(root);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'min7-boundaries-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('check-boundaries', () => {
  it('accepts the allowed graph', () => {
    assert.deepEqual(workspace({}), []);
  });

  it('rejects a workspace alias that installs signals under the contracts name', () => {
    const aliased = JSON.stringify({
      name: '@min7/site',
      dependencies: { '@min7/contracts': 'workspace:@min7/signals@*' },
    });
    const violations = workspace(
      {
        'apps/site/package.json': aliased,
        'apps/site/src/page.ts': "export { local } from '@min7/contracts/src/local.ts';\n",
        'apps/site/src/Page.astro': '<p>no imports</p>\n',
      },
      { contracts: 'apps/signals' }
    );
    assert.ok(
      violations.some((v) =>
        /package.json: dependencies.@min7\/contracts is an alias of @min7\/signals/.test(v)
      ),
      violations.join('\n')
    );
    assert.ok(
      violations.some((v) =>
        /src\/page.ts: imports @min7\/contracts\/src\/local.ts, which resolves into @min7\/signals/.test(
          v
        )
      ),
      violations.join('\n')
    );
  });

  const forbidden: [string, Record<string, string>, RegExp][] = [
    [
      'site manifest depending on signals',
      {
        'apps/site/package.json': JSON.stringify({
          name: '@min7/site',
          devDependencies: { '@min7/signals': 'workspace:*' },
        }),
      },
      /apps\/site\/package.json: devDependencies has @min7\/signals/,
    ],
    [
      'signals manifest depending on site by path',
      {
        'apps/signals/package.json': JSON.stringify({
          name: '@min7/signals',
          dependencies: { site: 'link:../site' },
        }),
      },
      /apps\/signals\/package.json: dependencies.site points into @min7\/site/,
    ],
    [
      'contracts manifest depending on an app',
      {
        'packages/contracts/package.json': JSON.stringify({
          name: '@min7/contracts',
          dependencies: { '@min7/signals': 'workspace:*' },
        }),
      },
      /packages\/contracts\/package.json: dependencies has @min7\/signals/,
    ],
    [
      'site tsconfig referencing signals',
      { 'apps/site/tsconfig.json': '{ "references": [{ "path": "../signals" }] }' },
      /apps\/site\/tsconfig.json: references @min7\/signals/,
    ],
    [
      'contracts tsconfig referencing site',
      { 'packages/contracts/tsconfig.json': '{ "references": [{ "path": "../../apps/site" }] }' },
      /packages\/contracts\/tsconfig.json: references @min7\/site/,
    ],
    [
      'site path alias into signals',
      {
        'apps/site/tsconfig.json':
          '{ "compilerOptions": { "paths": { "@sig/*": ["../signals/src/*"] } } }',
        'apps/site/src/alias.ts': "import { local } from '@sig/local.ts';\nexport { local };\n",
      },
      /apps\/site\/tsconfig.json: path alias @sig\/\* maps into @min7\/signals/,
    ],
    [
      'site importing signals by package name',
      { 'apps/site/src/bad.ts': "import { local } from '@min7/signals';\nexport { local };\n" },
      /apps\/site\/src\/bad.ts: imports @min7\/signals/,
    ],
    [
      'signals importing site by relative path',
      {
        'apps/signals/src/bad.ts':
          "import { contract } from '../../site/src/page.ts';\nexport { contract };\n",
      },
      /apps\/signals\/src\/bad.ts: imports \.\.\/\.\.\/site\/src\/page.ts from @min7\/site/,
    ],
    [
      'signals re-exporting site',
      { 'apps/signals/src/bad.ts': "export * from '@min7/site';\n" },
      /apps\/signals\/src\/bad.ts: imports @min7\/site/,
    ],
    [
      'contracts importing an app',
      {
        'packages/contracts/src/bad.ts':
          "export { local } from '../../../apps/signals/src/local.ts';\n",
      },
      /packages\/contracts\/src\/bad.ts: imports .* from @min7\/signals/,
    ],
    [
      'site dynamically importing signals',
      { 'apps/site/src/lazy.ts': "export const load = () => import('@min7/signals');\n" },
      /apps\/site\/src\/lazy.ts: imports @min7\/signals/,
    ],
    [
      'astro frontmatter importing signals',
      {
        'apps/site/src/Bad.astro':
          "---\nimport { local } from '../../signals/src/local.ts';\n---\n<p>{local}</p>\n",
      },
      /apps\/site\/src\/Bad.astro: imports .* from @min7\/signals/,
    ],
    [
      'svelte script importing signals',
      {
        'apps/site/src/Bad.svelte':
          '<script lang="ts">\n  import { local } from \'@min7/signals\';\n</script>\n<p>{local}</p>\n',
      },
      /apps\/site\/src\/Bad.svelte: imports @min7\/signals/,
    ],
    [
      'astro template expression importing signals',
      {
        'apps/site/src/Template.astro':
          "---\n---\n<p>{(await import('../../signals/src/local.ts')).local}</p>\n",
      },
      /apps\/site\/src\/Template.astro: imports .* from @min7\/signals/,
    ],
    [
      'svelte template block importing signals',
      {
        'apps/site/src/Template.svelte':
          "{#await import('../../signals/src/local.ts') then m}\n  <p>{m.local}</p>\n{/await}\n",
      },
      /apps\/site\/src\/Template.svelte: imports .* from @min7\/signals/,
    ],
    [
      'astro script tag loading a signals file',
      {
        'apps/site/src/Src.astro': '---\n---\n<script src="../../signals/src/local.ts"></script>\n',
      },
      /apps\/site\/src\/Src.astro: imports .* from @min7\/signals/,
    ],
    [
      'import.meta.glob in a .ts file reaching into signals',
      {
        'apps/site/src/g.ts':
          "export const m = import.meta.glob('../../signals/src/*.ts', { eager: true });\n",
      },
      /apps\/site\/src\/g.ts: imports \.\.\/\.\.\/signals\/src\/ from @min7\/signals/,
    ],
    [
      'import.meta.glob array in astro frontmatter reaching into signals',
      {
        'apps/site/src/G.astro':
          "---\nconst m = import.meta.glob(['./*.ts', \"../../signals/**/*.ts\", '!**/skip.ts']);\n---\n<p />\n",
      },
      /apps\/site\/src\/G.astro: imports \.\.\/\.\.\/signals\/ from @min7\/signals/,
    ],
    [
      'site reaching into contracts by path',
      {
        'apps/site/src/deep.ts':
          "export { contract } from '../../../packages/contracts/src/index.ts';\n",
      },
      /apps\/site\/src\/deep.ts: reaches into @min7\/contracts by path/,
    ],
    [
      'signals importing a file outside every unit',
      {
        'scripts/shared.ts': 'export const shared = 1;\n',
        'apps/signals/src/bad.ts': "export { shared } from '../../../scripts/shared.ts';\n",
      },
      /apps\/signals\/src\/bad.ts: imports .*, which is outside apps\/signals/,
    ],
  ];

  for (const [name, changes, expected] of forbidden) {
    it(`rejects ${name}`, () => {
      const violations = workspace(changes);
      assert.ok(
        violations.some((v) => expected.test(v)),
        violations.join('\n') || 'no violations'
      );
    });
  }
});
