// The text and Markdown copies through the real Worker (ADR 0040): who gets which, what a cache
// is told, and what search engines and drafts see. Tests that need a post carry @drafts.
import { readdirSync, readFileSync } from 'node:fs';
import { get as httpGet } from 'node:http';
import { join } from 'node:path';
import type { APIRequestContext } from '@playwright/test';
import { terminalCells } from '../src/lib/terminal-room.ts';
import { notes, posts } from './content.ts';
import { expect, notFoundPath, test } from './fixtures.ts';

const dist = join(import.meta.dirname, '..', 'dist');
const browser = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/156.0 Safari/537.36';
const browserAccept =
  'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8';
const curl = 'curl/8.11.1';

/** The page each built text copy belongs to; robots, the IndexNow key and llms.txt have none. */
const textPages = readdirSync(dist, { recursive: true, encoding: 'utf8' })
  .filter((file) => file.endsWith('.txt') && !file.startsWith('pagefind/'))
  .filter(
    (file) => file !== 'robots.txt' && file !== 'llms.txt' && !/^[0-9a-f]{32}\.txt$/.test(file)
  )
  .map((file) => `/${file.replace(/\.txt$/, '')}`.replace(/^\/index$/, '/'));

const get = (request: APIRequestContext, path: string, headers: Record<string, string>) =>
  request.get(path, { headers, maxRedirects: 0 });

test.describe('terminal clients', () => {
  // Catches a page with a built copy that run_worker_first does not route to the Worker.
  test('get the text of every page that has one', async ({ request }) => {
    expect(textPages.length).toBeGreaterThanOrEqual(14);
    for (const path of textPages) {
      const response = await get(request, path, { 'User-Agent': curl, Accept: '*/*' });
      expect(response.status(), path).toBe(200);
      expect(response.headers()['content-type'], path).toBe('text/plain; charset=utf-8');
      expect(await response.text(), path).toBe(
        readFileSync(join(dist, `${path === '/' ? 'index' : path.slice(1)}.txt`), 'utf8')
      );
    }
  });

  // Catches a browser getting text, the one thing this feature must never do.
  test('are the only ones: browsers get every page as HTML', async ({ request }) => {
    for (const path of textPages) {
      const response = await get(request, path, { 'User-Agent': browser, Accept: browserAccept });
      expect(response.headers()['content-type'], path).toContain('text/html');
    }
  });

  // Catches a page with no text copy answering a terminal with an error instead of its HTML.
  test('get the HTML of a page without a copy', async ({ request }) => {
    const response = await get(request, '/colophon', { 'User-Agent': curl });
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('text/html');
  });
});

test.describe('the room in colour', () => {
  // Catches the room leaving the Worker broken, a line past 80 columns, or a listed command that
  // gives a terminal anything but text.
  test('prints 80 columns and commands that work', async ({ request }) => {
    const response = await get(request, '/room', { 'User-Agent': curl, Accept: '*/*' });
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toBe('text/plain; charset=utf-8');
    expect(response.headers()['x-content-type-options']).toBe('nosniff');
    expect(response.headers().vary).toMatch(/\bAccept\b.*\bUser-Agent\b/);
    const lines = (await response.text()).split('\n');
    const shown = lines.map((line) => line.replace(/\p{Cc}\[[0-9;]*m/gu, ''));
    expect(shown.slice(0, 13)).toEqual(Array(13).fill('▀'.repeat(80)));
    for (const line of shown) expect(terminalCells(line)).toBeLessThanOrEqual(80);
    expect(shown.at(-2)).toBe('Without colour: curl ayagmar.dev');
    const paths = shown.flatMap((line) => /^ {2}curl ayagmar\.dev(\/\w+)$/.exec(line)?.[1] ?? []);
    expect(paths).toEqual(['/writing', '/til', '/projects', '/stats', '/about', '/now']);
    for (const path of paths) {
      const page = await get(request, path, { 'User-Agent': curl, Accept: '*/*' });
      expect(page.status(), path).toBe(200);
      expect(page.headers()['content-type'], path).toBe('text/plain; charset=utf-8');
    }
  });

  // Catches escape codes reaching a client that never asked for them: the plain copy has none.
  test('is only ever asked for', async ({ request }) => {
    const plain = await (await get(request, '/', { 'User-Agent': curl })).text();
    expect(plain).not.toContain('\x1b');
    expect(plain).toContain('curl ayagmar.dev/room\n');
    for (const headers of [
      { 'User-Agent': browser, Accept: browserAccept },
      { 'User-Agent': curl, Accept: 'text/markdown' },
    ]) {
      const response = await get(request, '/room', headers);
      expect(response.status()).toBe(307);
      expect(response.headers().location).toBe('/');
      expect(response.headers().vary).toMatch(/User-Agent/);
    }
  });

  // Catches HEAD printing the room's body.
  test('HEAD has no body', async ({ request }) => {
    const response = await request.head('/room', { headers: { 'User-Agent': curl } });
    expect(response.status()).toBe(200);
    expect(await response.text()).toBe('');
  });

  // Catches a Preview pointing its readers at production.
  test('names the Preview on a Preview', { tag: '@drafts' }, async ({ request }) => {
    const origin = 'https://feat-e2e-preview-min7-site.ayagmar.workers.dev';
    const room = await (await get(request, '/room', { 'User-Agent': curl })).text();
    expect(room).toContain(`  curl ${origin}/writing\n`);
    expect(room.endsWith(`Without colour: curl ${origin}\n`)).toBe(true);
    expect(await (await request.get('/index.txt')).text()).toContain(`curl ${origin}/room\n`);
  });
});

test.describe('Accept', () => {
  const page = '/about';
  for (const [accept, type] of [
    ['*/*', 'text/html'],
    ['text/html, text/markdown;q=0.5', 'text/html'],
    ['text/html, text/markdown', 'text/html'],
    ['text/markdown;q=0.5, text/html;q=0.9', 'text/html'],
    ['text/*', 'text/html'],
    ['text/markdown;q=0', 'text/html'],
    ['text/markdown;q=banana', 'text/html'],
    ['text/*;q=1, text/markdown;q=0.9', 'text/html'],
    ['*/*, text/markdown', 'text/html'],
    ['text/markdown;q=0, */*', 'text/html'],
    ['text/html;charset=iso-8859-1;q=0, */*;q=1, text/markdown;q=0.5', 'text/html'],
    ['text/markdown;charset=iso-8859-1', 'text/html'],
    [';;;,,q=', 'text/html'],
    ['application/json', 'text/html'],
    [browserAccept, 'text/html'],
    ['text/markdown', 'text/plain'],
    ['TEXT/MARKDOWN', 'text/plain'],
    ['text/markdown, text/html', 'text/plain'],
    ['text/markdown, */*;q=0.1', 'text/plain'],
    ['text/html;q=0.5, text/markdown;q=0.9', 'text/plain'],
    ['text/*;q=1, text/html;q=0.1, text/markdown;q=0.9, application/xhtml+xml;q=0.1', 'text/plain'],
    ['text/html;q=0, */*;q=0.9, text/markdown;q=0.5', 'text/plain'],
    ['text/html;charset=utf-8;q=0, */*;q=1, text/markdown;q=0.5', 'text/plain'],
    ['text/markdown;charset=utf-8', 'text/plain'],
  ] as const) {
    // Catches a parser that answers a browser or crawler with a copy, or misses a real preference.
    test(`"${accept}" gets ${type} from a page without Markdown`, async ({ request }) => {
      const response = await get(request, page, { 'User-Agent': browser, Accept: accept });
      expect(response.status()).toBe(200);
      expect(response.headers()['content-type']).toContain(type);
    });
  }

  // Catches a request with no Accept header at all throwing in the Worker.
  test('a missing header gets HTML', async ({ baseURL }) => {
    // node:http sends no Accept of its own; Playwright's client always does.
    const type = await new Promise((resolve, reject) => {
      httpGet(`${baseURL}${page}`, { headers: { 'User-Agent': browser } }, (response) => {
        response.resume();
        resolve(response.headers['content-type']);
      }).on('error', reject);
    });
    expect(type).toContain('text/html');
  });
});

test.describe('caches', () => {
  // Catches a shared cache storing one answer for every client: each one that could differ says
  // what it depends on, the HTML and the 404 as much as the copies.
  for (const [name, path, headers, status] of [
    ['the HTML', '/about', { 'User-Agent': browser }, 200],
    ['the text', '/about', { 'User-Agent': curl }, 200],
    ['the Markdown preference', '/about', { 'User-Agent': browser, Accept: 'text/markdown' }, 200],
    ['a 404 for a browser', '/writing/no-such-post', { 'User-Agent': browser }, 404],
    ['a 404 for a terminal', '/writing/no-such-post', { 'User-Agent': curl }, 404],
    ['a trailing-slash redirect', '/writing/', { 'User-Agent': curl }, 307],
  ] as const) {
    test(`${name} carries Vary`, async ({ request }) => {
      const response = await get(request, path, headers);
      expect(response.status()).toBe(status);
      expect(response.headers().vary).toMatch(/\bAccept\b.*\bUser-Agent\b/);
    });
  }

  // Catches the Worker turning a conditional request into an error or a full body, and a
  // validator from one variant matching the other.
  test('each variant revalidates on its own', async ({ request }) => {
    const text = await get(request, '/about', { 'User-Agent': curl });
    const etag = text.headers().etag ?? '';
    const again = await get(request, '/about', { 'User-Agent': curl, 'If-None-Match': etag });
    expect(again.status()).toBe(304);
    expect(again.headers().vary).toMatch(/User-Agent/);
    const other = await get(request, '/about', { 'User-Agent': browser, 'If-None-Match': etag });
    expect(other.status()).toBe(200);
    expect(other.headers()['content-type']).toContain('text/html');
  });
});

test.describe('paths', () => {
  // Catches a copy under a page's URL shadowing the page's own redirect.
  test('a trailing slash redirects to the page for every client', async ({ request }) => {
    for (const agent of [browser, curl]) {
      const response = await get(request, '/writing/', { 'User-Agent': agent });
      expect(response.status()).toBe(307);
      expect(response.headers().location).toBe('/writing');
    }
  });

  // Catches an unknown path becoming a 200 through the copy lookup.
  test('unknown paths and pages without a copy stay 404', async ({ request }) => {
    for (const path of [notFoundPath, '/writing/no-such-post', '/about.md', '/writing.md']) {
      for (const headers of [
        { 'User-Agent': browser },
        { 'User-Agent': curl },
        { 'User-Agent': browser, Accept: 'text/markdown' },
      ]) {
        expect((await get(request, path, headers)).status(), path).toBe(404);
      }
    }
  });

  // Catches feeds and copies under a routed path costing a Worker run: the Worker adds Vary.
  test('feeds and copies skip the Worker', async ({ request }) => {
    for (const path of ['/til/feed.xml', '/about.txt', '/llms.txt']) {
      const response = await get(request, path, { 'User-Agent': curl });
      expect(response.status(), path).toBe(200);
      expect(response.headers().vary ?? '', path).not.toMatch(/User-Agent/);
    }
  });

  // Catches HEAD losing the headers or gaining a body when it goes through the copy lookup.
  test('HEAD answers like GET, without a body', async ({ request }) => {
    const response = await request.head('/about', { headers: { 'User-Agent': curl } });
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('text/plain');
    expect(response.headers().vary).toMatch(/User-Agent/);
    expect(await response.text()).toBe('');
    const missing = await request.head('/writing/no-such-post', {
      headers: { 'User-Agent': curl },
    });
    expect(missing.status()).toBe(404);
  });
});

test.describe('search engines', () => {
  // Catches a copy competing with its page in search, or the rule reaching the pages themselves.
  test('copies are noindex and pages are not', async ({ request }) => {
    expect((await request.get('/about.txt')).headers()['x-robots-tag']).toBe('noindex');
    expect((await get(request, '/about', { 'User-Agent': curl })).headers()['x-robots-tag']).toBe(
      'noindex'
    );
    expect(
      (await get(request, '/about', { 'User-Agent': browser })).headers()['x-robots-tag']
    ).toBeUndefined();
  });

  // Catches a text copy leaving the headers of the rest of the site behind (ADR 0019).
  test('copies carry the security headers', async ({ request }) => {
    const headers = (await get(request, '/about', { 'User-Agent': curl })).headers();
    expect(headers['content-security-policy']).toContain("default-src 'none'");
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['strict-transport-security']).toMatch(/^max-age=\d{8,}/);
  });

  // Catches a copy reaching the sitemap, which seo-check would also refuse.
  test('the sitemap lists no copy', () => {
    const sitemap = readFileSync(join(dist, 'sitemap-0.xml'), 'utf8');
    expect(sitemap).not.toMatch(/\.(md|txt)</);
  });
});

test.describe('drafts on the production build', () => {
  const drafts = [
    ...posts.filter((post) => post.draft).map(({ slug }) => `/writing/${slug}`),
    ...notes.filter((note) => note.draft).map(({ slug }) => `/til/${slug}`),
  ];
  const lists = textPages.filter((path) => !/^\/(writing|til)\/./.test(path));

  // Catches a draft's copy being built, or its slug reaching any text an agent reads. Notes are
  // covered here once one exists; test/text-drafts.test.ts builds one regardless.
  test('are 404 in every variant and listed nowhere', async ({ request }) => {
    expect(lists).toEqual(expect.arrayContaining(['/', '/til', '/projects/runnerd']));
    const texts = await Promise.all(
      [...lists.map((path) => `${path === '/' ? '/index' : path}.txt`), '/llms.txt'].map(
        async (path) => [path, await (await request.get(path)).text()] as const
      )
    );
    for (const draft of drafts) {
      for (const path of [draft, `${draft}.md`, `${draft}.txt`]) {
        for (const headers of [
          { 'User-Agent': browser },
          { 'User-Agent': curl },
          { 'User-Agent': browser, Accept: 'text/markdown' },
        ]) {
          expect((await get(request, path, headers)).status(), path).toBe(404);
        }
      }
      for (const [path, text] of texts) expect(text, path).not.toContain(draft);
    }
  });
});

test.describe('llms.txt', () => {
  // Catches a link in the file that does not resolve on the site it describes.
  test('links only what the build has', async ({ request }) => {
    const response = await request.get('/llms.txt');
    expect(response.headers()['content-type']).toBe('text/plain; charset=utf-8');
    const text = await response.text();
    expect(text.startsWith('# min7\n\n> ')).toBe(true);
    const links = [...text.matchAll(/\]\(https:\/\/ayagmar\.dev(\/[^)]*)\)/g)].map(([, p]) => p);
    expect(links.length).toBeGreaterThanOrEqual(14);
    for (const path of links) expect((await request.get(path ?? '')).status(), path).toBe(200);
  });
});

test.describe('a post', () => {
  const slug = 'token-logs';
  const path = `/writing/${slug}`;

  // Catches any of the three ways to a post's copies breaking, on a post with diagrams.
  test('has text, negotiated Markdown and a Markdown URL', { tag: '@drafts' }, async ({
    request,
  }) => {
    const text = await get(request, path, { 'User-Agent': curl });
    expect(text.headers()['content-type']).toBe('text/plain; charset=utf-8');
    expect(await text.text()).toContain('[Diagram: From session log to token totals]');

    const direct = await request.get(`${path}.md`);
    expect(direct.headers()['content-type']).toBe('text/markdown; charset=utf-8');
    expect(direct.headers()['x-robots-tag']).toBe('noindex');
    const markdown = await direct.text();
    expect(markdown).toContain(`canonical: https://ayagmar.dev${path}\n`);
    expect(markdown).toContain('```mermaid\nflowchart TB\n');

    for (const agent of [curl, browser]) {
      const negotiated = await get(request, path, { 'User-Agent': agent, Accept: 'text/markdown' });
      expect(negotiated.headers()['content-type']).toBe('text/markdown; charset=utf-8');
      expect(negotiated.headers().vary).toMatch(/Accept/);
      expect(await negotiated.text()).toBe(markdown);
    }
  });

  // Catches code-copy buttons, diagram SVG or any other page markup reaching a copy.
  test('copies carry no HTML from the page', { tag: '@drafts' }, async ({ request }) => {
    for (const copy of [`${path}.md`, `${path}.txt`]) {
      expect(await (await request.get(copy)).text(), copy).not.toMatch(/<(svg|button|div)\b/);
    }
  });

  // Catches a Preview's own lists leaving out the drafts it shows.
  test('is listed in the preview build', { tag: '@drafts' }, async ({ request }) => {
    expect(await (await request.get('/llms.txt')).text()).toContain(`${path}.md)`);
    expect(await (await request.get('/writing.txt')).text()).toContain(`${path}\n`);
  });
});
