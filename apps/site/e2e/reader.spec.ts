// The post reader on a phone (ADR 0026): text near the screen edges, a one-row header, and both
// themes readable.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures.ts';

const post = '/writing/token-logs';

test.describe('on a 390px phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  // Catches card chrome or a paper margin coming back and squeezing the text column.
  test('the post text runs nearly edge to edge', async ({ page }) => {
    await page.goto(post);
    const box = await page.locator('.reader > .prose').boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(390 - 2 * 20);
  });

  // Catches a header that wraps to several rows again, a keyboard hint on a touch screen, or a
  // nav that the Menu button cannot reach.
  test('the header is one row and Menu opens the nav and the theme switch', async ({ page }) => {
    await page.goto(post);
    await expect(page.getByRole('button', { name: /search/i })).toBeVisible();
    const header = await page.locator('.site-header').boundingBox();
    expect(header?.height).toBeLessThan(64);
    await expect(page.locator('.site-header kbd')).toBeHidden();

    const nav = page.getByRole('navigation', { name: 'Site' });
    await expect(nav).toBeHidden();
    await page.getByRole('button', { name: 'Menu' }).click();
    await expect(nav.getByRole('link', { name: 'TIL' })).toBeVisible();
    await expect(nav.getByRole('group', { name: 'Theme' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(nav).toBeHidden();
  });
});

// Catches a Menu panel taller than a short landscape phone, which leaves the theme switch below
// the screen with no way to scroll to it.
test.describe('on a 568x320 landscape phone', () => {
  test.use({ viewport: { width: 568, height: 320 }, hasTouch: true });

  test('Menu scrolls inside itself so a theme button can be pressed', async ({ page }) => {
    await page.goto(post);
    await page.getByRole('button', { name: 'Menu' }).click();
    const theme = page.getByRole('group', { name: 'Theme' });
    await theme.getByRole('button', { name: 'Night' }).click({ timeout: 3000 });
    await expect(theme.getByRole('button', { pressed: true })).toHaveText('Night');
  });
});

// Catches a Menu left open on a phone staying a floating panel after the window grows to the
// desktop layout (a rotated tablet, a resized window), where the nav row should be in the header.
test('an open Menu closes when the window grows to the desktop layout', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(post);
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.locator('#site-menu')).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 800 });
  const link = page.getByRole('navigation', { name: 'Site' }).getByRole('link', { name: 'TIL' });
  await expect(link).toBeVisible();
  const header = await page.locator('.site-header').boundingBox();
  const box = await link.boundingBox();
  expect(box?.y).toBeLessThan((header?.y ?? 0) + (header?.height ?? 0));
  await expect(page.locator('#site-menu')).not.toHaveJSProperty('popoverOpen', true);
});

// Catches reader colours (text, links, the quote and rule pixels, the paper diagram cards) that
// pass in day and fail on the night ground; pages.spec.ts checks the day.
for (const width of [360, 1280]) {
  test(`a post has no axe violations at night at ${width}px`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.setViewportSize({ width, height: 800 });
    await page.goto(post);
    await expect(page.getByRole('button', { name: /search/i })).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
      .analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.length} nodes`)).toEqual([]);
  });
}
