import { expect, test } from './fixtures.ts';

test('Ctrl+K opens search and finds a post', async ({ page }) => {
  await page.goto('/about');
  await expect(page.getByRole('button', { name: /search/i })).toBeVisible();

  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Search' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Search posts').fill('token logs');

  const result = dialog.getByRole('link', { name: /what 17 coding agents taught me/ });
  await expect(result).toHaveAttribute('href', '/writing/token-logs');
  await result.click();
  await expect(page).toHaveURL(/\/writing\/token-logs$/);
});

test('/ opens search; drafts are not in the index', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: /search/i })).toBeVisible();

  await page.keyboard.press('/');
  const dialog = page.getByRole('dialog', { name: 'Search' });
  await dialog.getByLabel('Search posts').fill('ricing');
  await expect(dialog.getByRole('status')).toHaveText('No results.');
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('offers a link instead of the search button', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Browse writing' })).toHaveAttribute(
      'href',
      '/writing'
    );
  });
});

test('the open search dialog keeps 24px targets and fits a 320px screen', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: /search/i })).toBeVisible();
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Search' });
  await dialog.getByLabel('Search posts').fill('token logs');
  await expect(dialog.getByRole('link').first()).toBeVisible();

  const targets = dialog.locator('input, button, a');
  expect(await targets.count()).toBeGreaterThanOrEqual(3);
  for (const target of await targets.all()) {
    const box = await target.boundingBox();
    const name = await target.evaluate((element) => element.outerHTML.slice(0, 60));
    expect(box?.width, name).toBeGreaterThanOrEqual(24);
    expect(box?.height, name).toBeGreaterThanOrEqual(24);
  }
  const overflow = await page.evaluate(() => {
    const open = document.querySelector('dialog[open]');
    return Math.max(
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
      open === null ? 0 : open.scrollWidth - open.clientWidth
    );
  });
  expect(overflow).toBeLessThanOrEqual(0);
});
