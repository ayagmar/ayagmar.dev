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
  await dialog.getByLabel('Search posts').fill('niri');
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
