import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, feeds, notFoundPath, test } from './fixtures.ts';

const browser = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/156.0 Safari/537.36';

const expectSecurityHeaders = (headers: Record<string, string>) => {
  const csp = headers['content-security-policy'] ?? '';
  expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'");
  expect(csp).toContain("connect-src 'self' https://api.ayagmar.dev");
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("base-uri 'none'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).not.toContain('unsafe-inline');
  expect(headers['strict-transport-security']).toMatch(/^max-age=\d{8,}/);
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(headers['permissions-policy']).toContain('camera=()');
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['x-frame-options']).toBe('DENY');
};

test.describe('responses', () => {
  for (const [path, status, type] of [
    ['/', 200, 'text/html'],
    ['/writing/token-logs', 200, 'text/html'],
    ['/index.txt', 200, 'text/plain'],
    [notFoundPath, 404, 'text/html'],
  ] as const) {
    test(`${path} carries the security headers`, async ({ request }) => {
      const response = await request.get(path, { headers: { 'User-Agent': browser } });
      expect(response.status()).toBe(status);
      expect(response.headers()['content-type']).toContain(type);
      expectSecurityHeaders(response.headers());
    });
  }

  for (const agent of ['curl/8.11.1', 'Wget/1.25.0', 'HTTPie/3.2.4', 'xh/0.24.0']) {
    test(`${agent} gets the plain-text home page`, async ({ request }) => {
      const response = await request.get('/', { headers: { 'User-Agent': agent } });
      expect(response.status()).toBe(200);
      expect(response.headers()['content-type']).toContain('text/plain');
      expect(response.headers().vary).toMatch(/user-agent/i);
      expectSecurityHeaders(response.headers());
      expect(await response.text()).toContain('min7 | Abdeslam Yassine Agmar');
    });
  }

  test('browsers get the HTML home page', async ({ request }) => {
    const response = await request.get('/', { headers: { 'User-Agent': browser } });
    expect(response.headers()['content-type']).toContain('text/html');
    expect(response.headers().vary).toMatch(/user-agent/i);
    expect(await response.text()).toContain('<!DOCTYPE html>');
  });

  test("every _headers line fits Cloudflare's limit", () => {
    const file = readFileSync(join(import.meta.dirname, '..', 'dist', '_headers'), 'utf8');
    for (const line of file.split('\n')) expect(line.length).toBeLessThan(2000);
  });
});

test.describe('feeds', () => {
  test('the build wrote site-wide, tag and project feeds', () => {
    expect(feeds).toEqual(
      expect.arrayContaining([
        '/feed.xml',
        '/atom.xml',
        '/writing/tags/rust/feed.xml',
        '/projects/runnerd/feed.xml',
        '/projects/headroom/atom.xml',
      ])
    );
  });

  for (const path of feeds) {
    test(`${path} is well-formed XML without drafts`, async ({ page, request }) => {
      const xml = await (await request.get(path)).text();
      await page.goto('/index.txt');
      const parsed = await page.evaluate((source) => {
        const doc = new DOMParser().parseFromString(source, 'application/xml');
        return {
          error: doc.querySelector('parsererror')?.textContent ?? null,
          root: doc.documentElement.nodeName,
          links: [...doc.querySelectorAll('link')].map(
            (l) => l.getAttribute('href') ?? l.textContent
          ),
        };
      }, xml);
      expect(parsed.error).toBeNull();
      expect(parsed.root).toBe(path.endsWith('atom.xml') ? 'feed' : 'rss');
      for (const link of parsed.links) expect(link).toMatch(/^https:\/\/ayagmar\.dev\//);
      expect(xml).not.toContain('ricing-niri');
    });
  }
});
