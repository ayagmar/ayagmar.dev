import AxeBuilder from '@axe-core/playwright';
import { expect, notFoundPath, pages, test } from './fixtures.ts';

const viewports = [
  { width: 360, height: 800 },
  { width: 1280, height: 800 },
];

for (const path of [...pages, notFoundPath]) {
  test.describe(path, () => {
    for (const viewport of viewports) {
      test(`has no axe violations at ${viewport.width}px`, async ({ page }) => {
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

    test('does not scroll sideways at 320px', async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 800 });
      await page.goto(path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  });
}

test('pages link their feeds for discovery', async ({ page }) => {
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
