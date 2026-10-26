// Builds two notes the way /til stacks them and checks every reference resolves inside its own
// note. Catches a heading or footnote id repeated across notes, which sends a `#fragment` link
// (a section link, a footnote mark, its backlink) into another note (ADR 0028).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { type SiteFixture, siteFixture } from './site-fixture.ts';

let fixture: SiteFixture;

const note = (title: string, footnote: string) =>
  `---\ntitle: ${title}\ndate: 2026-10-01\n---\n\nSee [the section](#example) and a footnote.[^1]\n\n## Example\n\nBody of ${title}.\n\n[^1]: ${footnote}\n`;

beforeEach(() => {
  fixture = siteFixture('min7-til-ids-');
  fixture.write(
    'apps/site/astro.config.ts',
    `import { satteri } from '@astrojs/markdown-satteri';
import { defineConfig } from 'astro/config';
import { diagrams } from './src/lib/markdown/diagrams.ts';
import { scopeIds } from './src/lib/markdown/scope-ids.ts';
export default defineConfig({
  cacheDir: './cache',
  build: { format: 'file' },
  markdown: { syntaxHighlight: false, processor: satteri({ hastPlugins: [scopeIds, diagrams] }) },
});
`
  );
  fixture.write(
    'apps/site/src/pages/til.astro',
    `---
import { getCollection, render } from 'astro:content';
const notes = await Promise.all((await getCollection('til')).map(async (n) => ({ n, ...(await render(n)) })));
---
{notes.map(({ n, Content }) => <article id={'in-' + n.id}><Content /></article>)}
`
  );
  fixture.write('content/til/first.md', note('First', 'This footnote belongs to First.'));
  fixture.write('content/til/second.md', note('Second', 'This footnote belongs to Second.'));
});
afterEach(() => {
  fixture.remove();
});

it('keeps ids, fragment links and aria references inside their own note', () => {
  const result = fixture.build();
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  const html = readFileSync(join(fixture.app, 'dist/til.html'), 'utf8');

  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(([, id]) => id);
  expect(new Set(ids).size, `repeated ids: ${ids.join(' ')}`).toBe(ids.length);

  for (const name of ['first', 'second']) {
    const article = new RegExp(`<article id="in-${name}">([\\s\\S]*?)</article>`).exec(html)?.[1];
    expect(article, name).toBeDefined();
    const own = new Set([...(article ?? '').matchAll(/\sid="([^"]+)"/g)].map(([, id]) => id));
    const wanted = [
      ...(article ?? '').matchAll(/href="#([^"]+)"/g),
      ...(article ?? '').matchAll(/aria-describedby="([^"]+)"/g),
    ].map(([, id]) => id ?? '');
    // The section link, the footnote mark, its backlink and the mark's description.
    expect(wanted.length, name).toBeGreaterThanOrEqual(4);
    for (const id of wanted) expect(own.has(id), `${name}: #${id}`).toBe(true);
    expect(article).toContain(`This footnote belongs to ${name === 'first' ? 'First' : 'Second'}.`);
  }
}, 60_000);
