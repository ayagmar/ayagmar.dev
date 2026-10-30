// Runs `astro build` on bad content and checks the build itself stops, naming the file and the
// slug. The schema and helper tests show the rules; this shows Astro enforces them.
import { stripVTControlCharacters } from 'node:util';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { type SiteFixture, siteFixture } from './site-fixture.ts';

let fixture: SiteFixture;

const post = (projects: string) =>
  `---\ntitle: A post\ndate: 2026-10-01\nsummary: 'One sentence.'\nprojects: ${projects}\n---\n\nHello.\n`;

beforeEach(() => {
  fixture = siteFixture('min7-content-build-');
  fixture.write(
    'apps/site/astro.config.mjs',
    "import { defineConfig } from 'astro/config';\nexport default defineConfig({ cacheDir: './cache' });\n"
  );
  fixture.write(
    'apps/site/src/pages/index.astro',
    "---\nimport { getCollection } from 'astro:content';\nconst posts = await getCollection('writing');\nconst projects = await getCollection('projects');\n---\n<p>{posts.length} {projects.length}</p>\n"
  );
  fixture.write('content/writing/fine.md', post('[runnerd]'));
  fixture.write('content/projects/runnerd.md', '---\nslug: runnerd\nstatus: active\n---\n');
});
afterEach(() => {
  fixture.remove();
});

const output = () => {
  const result = fixture.build();
  return {
    status: result.status,
    text: stripVTControlCharacters(`${result.stdout}\n${result.stderr}`),
  };
};

it('builds valid posts and project files', () => {
  expect(output().status).toBe(0);
}, 60_000);

it.each([
  ['a post names an unknown project', 'content/writing/bad.md', post('[runnerd, nope]'), 'nope'],
  [
    'a project file has an unknown slug',
    'content/projects/nope.md',
    '---\nslug: nope\nstatus: active\n---\n',
    'nope',
  ],
  [
    'a TIL note has a field only posts have',
    'content/til/bad.md',
    '---\ntitle: A note\ndate: 2026-10-01\nsummary: Posts have one.\n---\n\nHello.\n',
    'summary',
  ],
  [
    'content/now.md is dated in the future',
    'content/now.md',
    '---\nupdated: "2999-01-01"\n---\n\nSoon.\n',
    'updated: must not be in the future',
  ],
  [
    'content/now.md has an unquoted impossible day',
    'content/now.md',
    '---\nupdated: 2026-02-30\n---\n\nSoon.\n',
    'updated: must be a quoted day like "2026-10-30"',
  ],
  [
    'content/now.md has a quoted impossible day',
    'content/now.md',
    '---\nupdated: "2026-02-30"\n---\n\nSoon.\n',
    'updated: must be a real day like "2026-10-30"',
  ],
  [
    "a project file's slug differs from its name",
    'content/projects/ccdesk.md',
    '---\nslug: runnerd\nstatus: active\n---\n',
    'slug "runnerd" must match the file name (ccdesk)',
  ],
])(
  'fails the build when %s',
  (_case, path, text, message) => {
    fixture.write(path, text);
    const { status, text: log } = output();
    expect(status, log).not.toBe(0);
    expect(log).toContain(path);
    expect(log).toContain(message);
  },
  60_000
);
