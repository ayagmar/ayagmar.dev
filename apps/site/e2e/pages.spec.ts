import AxeBuilder from '@axe-core/playwright';
import { posts } from './content.ts';
import { expect, notFoundPath, pages, test } from './fixtures.ts';

const viewports = [
  { width: 360, height: 800 },
  { width: 1280, height: 800 },
];

// Every page in the sitemap, and on the drafts build the pages that show or list a post: while
// every post is a draft, production has none of them.
const checked = [
  // Day pages are noindex, so not in the sitemap: one stands for them all.
  ...[...pages, '/day/2026-10-25', notFoundPath].map((path) => ({
    path,
    title: path,
    details: {},
  })),
  ...[
    '/',
    '/writing',
    '/writing/tags/rust',
    '/projects/llm-usage-metrics',
    ...posts.map((post) => `/writing/${post.slug}`),
  ].map((path) => ({ path, title: `${path} with drafts`, details: { tag: '@drafts' } })),
];

for (const { path, title, details } of checked) {
  test.describe(title, () => {
    for (const viewport of viewports) {
      test(`has no axe violations at ${viewport.width}px`, details, async ({ page }) => {
        await page.setViewportSize(viewport);
        const response = await page.goto(path);
        expect(response?.status()).toBe(path === notFoundPath ? 404 : 200);
        // Wait for the search island so axe sees the hydrated page.
        await expect(page.getByRole('button', { name: /search/i })).toBeVisible();

        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
          .analyze();
        expect(results.violations.map((v) => `${v.id}: ${v.nodes.length} nodes`)).toEqual([]);
      });
    }

    test('does not scroll sideways at 320px', details, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 800 });
      await page.goto(path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  });
}

test('pages link their feeds for discovery', { tag: '@drafts' }, async ({ page }) => {
  await page.goto('/writing/tags/rust');
  const feeds = await page
    .locator('link[rel="alternate"]')
    .evaluateAll((links) =>
      links.map((link) => `${link.getAttribute('type')} ${link.getAttribute('href')}`)
    );
  expect(feeds).toEqual([
    'application/rss+xml /feed.xml',
    'application/atom+xml /atom.xml',
    'application/rss+xml /writing/tags/rust/feed.xml',
    'application/atom+xml /writing/tags/rust/atom.xml',
  ]);
});

test('the colophon shows the commit the site was built from', async ({ page }) => {
  await page.goto('/colophon');
  await expect(page.getByText(/This build:/)).toContainText(/[0-9a-f]{12}|dev/);
});
