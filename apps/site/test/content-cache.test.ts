import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';

const site = join(import.meta.dirname, '..');

let root: string;
let app: string;

function write(path: string, text: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/** A hast plugin standing in for the diagram renderer: it stamps a version on paragraphs. */
const renderer = (version: string) =>
  `export const renderer = { name: 'stamp', element: { filter: ['p'], visit(node, ctx) { ctx.setProperty(node, 'className', ['${version}']); } } };\n`;

function build() {
  const result = spawnSync(
    process.execPath,
    [join(site, 'node_modules/astro/bin/astro.mjs'), 'build'],
    {
      cwd: app,
      encoding: 'utf8',
      env: { ...process.env, HOME: root, ASTRO_TELEMETRY_DISABLED: '1' },
    }
  );
  expect(result.status, result.stderr).toBe(0);
  return readFileSync(join(app, 'dist/index.html'), 'utf8');
}

beforeEach(() => {
  // Same layout as the repo, so the site's own content config finds ../../content/writing.
  root = mkdtempSync(join(tmpdir(), 'min7-content-cache-'));
  app = join(root, 'apps/site');
  mkdirSync(join(app, 'src'), { recursive: true });
  // The content config and the schema modules it imports.
  copyFileSync(join(site, 'src/content.config.ts'), join(app, 'src/content.config.ts'));
  cpSync(join(site, 'src/lib'), join(app, 'src/lib'), { recursive: true });
  symlinkSync(join(site, 'node_modules'), join(app, 'node_modules'), 'dir');
  write(
    join(root, 'content/writing/post.md'),
    "---\ntitle: A post\ndate: 2026-10-01\nsummary: 'One sentence.'\n---\n\nHello.\n"
  );
  write(
    join(app, 'astro.config.mjs'),
    [
      "import { satteri } from '@astrojs/markdown-satteri';",
      "import { defineConfig } from 'astro/config';",
      "import { renderer } from './renderer.mjs';",
      // The content cache stays inside the fixture, never in the site's node_modules.
      "export default defineConfig({ cacheDir: './cache', markdown: { processor: satteri({ hastPlugins: [renderer] }) } });",
    ].join('\n')
  );
  write(
    join(app, 'src/pages/index.astro'),
    "---\nimport { getCollection, render } from 'astro:content';\nconst [post] = await getCollection('writing');\nconst { Content } = await render(post);\n---\n<Content />\n"
  );
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

// Catches posts that keep the old renderer's output (diagram SVG and its style classes) when
// only the renderer changed, because the content cache keys on the Markdown and config alone.
it('a rebuild with a warm content cache uses the current Markdown renderer', () => {
  write(join(app, 'renderer.mjs'), renderer('v1'));
  expect(build()).toContain('<p class="v1">Hello.</p>');

  write(join(app, 'renderer.mjs'), renderer('v2'));
  expect(build()).toContain('<p class="v2">Hello.</p>');
}, 120_000);
