// Link previews and icons: every built page names a 1200x630 PNG at the origin that build is
// served from, that build has it, and the icon files browsers and phones ask for by name are
// there, in the format their name promises. The local Worker stands in for each origin: it
// serves the same build, so a path it serves is a path that origin serves.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { APIRequestContext } from '@playwright/test';
import { expect, test } from './fixtures.ts';

const builds = {
  // Built outside Workers Builds, as CI and `just site-build` build: production's origin.
  production: {
    dir: join(import.meta.dirname, '..', 'dist'),
    origin: 'https://ayagmar.dev',
  },
  // Built with WORKERS_CI_BRANCH=feat/e2e-preview (playwright.config.ts): that branch's Preview.
  drafts: {
    dir: join(import.meta.dirname, '..', 'node_modules', '.cache', 'preview'),
    origin: 'https://feat-e2e-preview-min7-site.ayagmar.workers.dev',
  },
};

/** A `<meta property=...>` value of a page, or undefined. */
const meta = (html: string, property: string) =>
  html.match(new RegExp(`<meta property="${property}" content="([^"]*)"`))?.[1];

/** Width and height from a PNG's IHDR chunk. */
const pngSize = (png: Buffer) => ({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) });

async function checkPreviews(
  { dir, origin }: { dir: string; origin: string },
  request: APIRequestContext
) {
  const pages = readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((file) =>
    file.endsWith('.html')
  );
  expect(pages.length).toBeGreaterThan(10);
  const images = new Map<string, string[]>();
  for (const page of pages) {
    const html = readFileSync(join(dir, page), 'utf8');
    const image = meta(html, 'og:image');
    const url = new URL(image ?? '', 'invalid:/');
    expect(url.origin, `${page}: og:image ${image}`).toBe(origin);
    expect(url.pathname, page).toMatch(/^\/og\/.+\.png$/);
    expect(new URL(meta(html, 'og:url') ?? '', 'invalid:/').origin, `${page}: og:url`).toBe(origin);
    expect(meta(html, 'og:image:width'), page).toBe('1200');
    expect(meta(html, 'og:image:height'), page).toBe('630');
    expect(meta(html, 'og:image:alt'), page).toBeTruthy();
    expect(html, page).toContain('<meta name="twitter:card" content="summary_large_image">');
    const path = url.pathname;
    images.set(path, [...(images.get(path) ?? []), page]);
  }
  for (const [path, from] of images) {
    const response = await request.get(path);
    expect(response.status(), `${path} (from ${from.join(', ')})`).toBe(200);
    expect(response.headers()['content-type']).toBe('image/png');
    expect(pngSize(await response.body()), path).toEqual({ width: 1200, height: 630 });
  }
  return images;
}

test('every page names a link-preview image production serves', async ({ request }) => {
  const images = await checkPreviews(builds.production, request);
  // Notes get their own; the rest share the room's.
  expect([...images.keys()]).toContain('/og/default.png');
  expect([...images.keys()].some((path) => path.startsWith('/og/til/'))).toBe(true);
});

// Catches a Preview pointing crawlers at production, which has no image for an unpublished post.
test('a Preview names its own images, one per post @drafts', async ({ request }) => {
  const images = await checkPreviews(builds.drafts, request);
  expect([...images.keys()].filter((path) => path.startsWith('/og/writing/')).length).toBe(
    readdirSync(join(builds.drafts.dir, 'writing')).filter((file) => file.endsWith('.html')).length
  );
});

test.describe('icons', () => {
  const cached = (headers: Record<string, string>) =>
    expect(headers['cache-control']).toMatch(/max-age=[1-9]/);

  test('/favicon.ico holds the icon at 16 and 32 px', async ({ request }) => {
    const response = await request.get('/favicon.ico');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toMatch(/^image\/(x-icon|vnd\.microsoft\.icon)$/);
    cached(response.headers());
    const ico = await response.body();
    expect(ico.readUInt16LE(2)).toBe(1);
    const count = ico.readUInt16LE(4);
    const sizes = Array.from({ length: count }, (_, i) => ico.readUInt8(6 + 16 * i));
    expect(sizes).toEqual([16, 32]);
  });

  test('/favicon.svg is an SVG', async ({ request }) => {
    const response = await request.get('/favicon.svg');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('image/svg+xml');
    cached(response.headers());
    expect(await response.text()).toMatch(/^<svg [^>]*viewBox="0 0 32 32"/);
  });

  // iOS draws a transparent touch icon's corners black.
  test('/apple-touch-icon.png is an opaque 180 px PNG', async ({ request }) => {
    const response = await request.get('/apple-touch-icon.png');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toBe('image/png');
    cached(response.headers());
    const png = await response.body();
    expect(pngSize(png)).toEqual({ width: 180, height: 180 });
    // Colour type 4 and 6 carry alpha; a tRNS chunk makes a palette image transparent.
    expect([4, 6]).not.toContain(png.readUInt8(25));
    expect(png.includes('tRNS')).toBe(false);
  });
});
