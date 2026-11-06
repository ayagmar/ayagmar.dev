// A real build of the routes that list posts and notes, with a draft of each. While content/til
// is empty and every post a draft, the e2e checks have no published entry to tell apart from a
// draft, and none for a note at all, so this is where a draft reaching a copy would show.
import { cpSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { type SiteFixture, siteFixture } from './site-fixture.ts';

const site = join(import.meta.dirname, '..');
let fixture: SiteFixture;

const entry = (title: string, draft: boolean, summary = '') =>
  `---\ntitle: ${title}\ndate: 2026-10-01\n${summary}${draft ? 'draft: true\n' : ''}---\n\nBody of ${title}.\n`;

beforeEach(() => {
  fixture = siteFixture('min7-text-drafts-');
  cpSync(join(site, 'src/data'), join(fixture.app, 'src/data'), { recursive: true });
  for (const route of [
    'index.txt.ts',
    'llms.txt.ts',
    'til.txt.ts',
    'writing.txt.ts',
    'projects.txt.ts',
    'projects/[slug].txt.ts',
    'til/[slug].txt.ts',
    'til/[slug].md.ts',
    'writing/[slug].txt.ts',
    'writing/[slug].md.ts',
  ]) {
    fixture.write(
      `apps/site/src/pages/${route}`,
      readFileSync(join(site, 'src/pages', route), 'utf8')
    );
  }
  fixture.write(
    'apps/site/astro.config.ts',
    `import { defineConfig, envField } from 'astro/config';
const text = (fallback) => envField.string({ context: 'server', access: 'public', default: fallback });
export default defineConfig({
  cacheDir: './cache',
  site: 'https://ayagmar.dev',
  build: { format: 'file' },
  env: { schema: {
    PUBLIC_SHOW_DRAFTS: text(''),
    WORKERS_CI_BRANCH: text(''),
    SIGNALS_API_BASE: text('https://api.ayagmar.dev'),
    SIGNALS_MODE: envField.enum({ context: 'server', access: 'public', values: ['fixtures', 'api'], default: 'fixtures' }),
  } },
});
`
  );
  const summary = "summary: 'Says what it is.'\nprojects: [runnerd]\n";
  fixture.write('content/writing/shown-post.md', entry('Shown post', false, summary));
  fixture.write('content/writing/hidden-post.md', entry('Hidden post', true, summary));
  fixture.write('content/til/shown-note.md', entry('Shown note', false));
  fixture.write('content/til/hidden-note.md', entry('Hidden note', true));
  fixture.write('content/now.md', "---\nupdated: '2026-10-01'\n---\n\nNow.\n");
  fixture.write('content/projects/runnerd.md', '---\nslug: runnerd\nstatus: active\n---\n');
});
afterEach(() => {
  fixture.remove();
});

// Catches an endpoint reading a collection directly instead of the published list, which would
// put a draft post or note in a copy, a list or llms.txt on production.
it('keeps drafts out of every copy and list, and the published in', () => {
  const result = fixture.build();
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  const built = (path: string) => join(fixture.app, 'dist', path);
  for (const path of ['writing/shown-post', 'til/shown-note']) {
    expect(existsSync(built(`${path}.txt`)), path).toBe(true);
    expect(existsSync(built(`${path}.md`)), path).toBe(true);
  }
  for (const path of ['writing/hidden-post', 'til/hidden-note']) {
    expect(existsSync(built(`${path}.txt`)), path).toBe(false);
    expect(existsSync(built(`${path}.md`)), path).toBe(false);
  }
  for (const [path, shown] of [
    ['index.txt', ['Shown post', 'Shown note']],
    ['llms.txt', ['Shown post', 'Shown note']],
    ['til.txt', ['Shown note']],
    ['writing.txt', ['Shown post']],
    ['projects/runnerd.txt', ['Shown post']],
  ] as const) {
    const text = readFileSync(built(path), 'utf8');
    for (const title of shown) expect(text, path).toContain(title);
    expect(text, path).not.toMatch(/hidden-|Hidden /);
  }
  expect(readFileSync(built('projects.txt'), 'utf8')).toContain('runnerd\n');
  expect(readFileSync(built('projects.txt'), 'utf8')).toContain('1 post');
});
