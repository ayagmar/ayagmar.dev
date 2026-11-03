import { posts } from './content.ts';
import { expect, expectNoAxeViolations, notFoundPath, pages, test } from './fixtures.ts';

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

// Catches a page that scrolls sideways on a 320px phone, or fails axe at a phone or a desktop
// width. One load per page: the page is resized between the checks.
for (const { path, title, details } of checked) {
  test(`${title} fits 320px and passes axe at 360 and 1280px`, details, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    const response = await page.goto(path);
    expect(response?.status()).toBe(path === notFoundPath ? 404 : 200);
    // Wait for the search island so axe sees the hydrated page.
    await expect(page.getByRole('button', { name: /search/i })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow, 'overflow at 320px').toBeLessThanOrEqual(0);

    for (const width of [360, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      await test.step(`axe at ${width}px`, () => expectNoAxeViolations(page));
    }
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
