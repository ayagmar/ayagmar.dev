// scripts/seo-check.ts against small built sites in a temporary directory.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';

const check = join(import.meta.dirname, '..', 'scripts', 'seo-check.ts');

let root: string;
const write = (files: Record<string, string>) => {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
};
const run = () =>
  spawnSync(process.execPath, [check, join(root, 'dist'), join(root, 'content')], {
    encoding: 'utf8',
  });

const page = (path: string, title: string, head = '') =>
  `<!doctype html><html><head><title>${title}</title><meta name="description" content="About ${title}"><link rel="canonical" href="https://ayagmar.dev${path}">${head}</head><body></body></html>`;
const posting = (modified: string) =>
  `<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"BlogPosting","dateModified":"${modified}"}]}</script>`;
const sitemap = (...entries: string[]) =>
  `<?xml version="1.0" encoding="UTF-8"?><urlset>${entries.map((e) => `<url>${e}</url>`).join('')}</urlset>`;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'min7-seo-check-'));
  write({
    'content/writing/out.md': '---\ntitle: Out\ndraft: false\n---\n',
    'content/writing/soon.md': '---\ntitle: Soon\ndraft: true\n---\n',
    'content/til/.keep.md': '',
  });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

it('passes a site whose pages and sitemap agree', () => {
  write({
    'dist/index.html': page('/', 'Home'),
    'dist/writing/out.html': page('/writing/out', 'Out', posting('2026-10-12')),
    'dist/writing/tags/a.html': page(
      '/writing/tags/a',
      'Tagged a',
      '<meta name="robots" content="noindex">'
    ),
    'dist/sitemap-0.xml': sitemap(
      '<loc>https://ayagmar.dev/</loc>',
      '<loc>https://ayagmar.dev/writing/out</loc><lastmod>2026-10-12</lastmod>'
    ),
  });
  const result = run();
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
});

// Catches two GitHub repos with the same description stopping production from deploying.
it('only warns when project pages share a description, which comes from GitHub', () => {
  const project = (slug: string) =>
    page(`/projects/${slug}`, slug).replace(`About ${slug}`, 'A tool');
  write({
    'dist/projects/a.html': project('a'),
    'dist/projects/b.html': project('b'),
    'dist/sitemap-0.xml': sitemap(
      '<loc>https://ayagmar.dev/projects/a</loc>',
      '<loc>https://ayagmar.dev/projects/b</loc>'
    ),
  });
  const result = run();
  expect(result.status).toBe(0);
  expect(result.stderr).toContain('warning: projects/b.html: same description as projects/a.html');
});

it('names every page and sitemap entry search engines would read wrong', () => {
  write({
    'dist/index.html': page('/', 'Home', '<link rel="canonical" href="https://ayagmar.dev/x">'),
    'dist/about.html': page('/about', 'Home'),
    'dist/writing/out.html': page(
      '/writing/out',
      'Out',
      '<script type="application/ld+json">{"@type":</script>'
    ),
    'dist/til/note.html': page('/til/note', 'Note', posting('2026-10-01')),
    'dist/writing/soon.html': page('/writing/soon', 'Soon', posting('2026-10-02')),
    'dist/hidden.html': page('/hidden', 'Hidden', '<meta name="robots" content="noindex">'),
    'dist/sitemap-0.xml': sitemap(
      '<loc>https://ayagmar.dev/til/note</loc>',
      '<loc>https://ayagmar.dev/writing/soon</loc><lastmod>2026-10-02</lastmod>',
      '<loc>https://ayagmar.dev/hidden</loc>',
      '<loc>https://ayagmar.dev/gone</loc>'
    ),
  });
  const result = run();
  expect(result.status).toBe(1);
  for (const expected of [
    'index.html: 2 canonical links, not 1',
    'index.html: same title as about.html: Home',
    'index.html: same description as about.html: About Home',
    'writing/out.html: JSON-LD does not parse',
    'writing/out.html: a post or note without a BlogPosting',
    'lists https://ayagmar.dev/hidden, which is noindex',
    'lists https://ayagmar.dev/gone, which is not a built page',
    'https://ayagmar.dev/til/note has lastmod null, its JSON-LD dateModified 2026-10-01',
    'sitemap lists the draft /writing/soon',
  ]) {
    expect(result.stderr).toContain(expected);
  }
});
