import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { type SiteFixture, siteFixture } from './site-fixture.ts';

let fixture: SiteFixture;

/** A hast plugin standing in for the diagram renderer: it stamps a version on paragraphs. */
const renderer = (version: string) =>
  `export const renderer = { name: 'stamp', element: { filter: ['p'], visit(node, ctx) { ctx.setProperty(node, 'className', ['${version}']); } } };\n`;

function build() {
  const result = fixture.build();
  expect(result.status, result.stderr).toBe(0);
  return readFileSync(join(fixture.app, 'dist/index.html'), 'utf8');
}

beforeEach(() => {
  fixture = siteFixture('min7-content-cache-');
  fixture.write(
    'content/writing/post.md',
    "---\ntitle: A post\ndate: 2026-10-01\nsummary: 'One sentence.'\n---\n\nHello.\n"
  );
  fixture.write(
    'apps/site/astro.config.mjs',
    [
      "import { satteri } from '@astrojs/markdown-satteri';",
      "import { defineConfig } from 'astro/config';",
      "import { renderer } from './renderer.mjs';",
      // The content cache stays inside the fixture, never in the site's node_modules.
      "export default defineConfig({ cacheDir: './cache', markdown: { processor: satteri({ hastPlugins: [renderer] }) } });",
    ].join('\n')
  );
  fixture.write(
    'apps/site/src/pages/index.astro',
    "---\nimport { getCollection, render } from 'astro:content';\nconst [post] = await getCollection('writing');\nconst { Content } = await render(post);\n---\n<Content />\n"
  );
});
afterEach(() => {
  fixture.remove();
});

// Catches posts that keep the old renderer's output (diagram SVG and its style classes) when
// only the renderer changed, because the content cache keys on the Markdown and config alone.
it('a rebuild with a warm content cache uses the current Markdown renderer', () => {
  fixture.write('apps/site/renderer.mjs', renderer('v1'));
  expect(build()).toContain('<p class="v1">Hello.</p>');

  fixture.write('apps/site/renderer.mjs', renderer('v2'));
  expect(build()).toContain('<p class="v2">Hello.</p>');
}, 120_000);
