import { expect, test } from './fixtures.ts';

test('Ctrl+K opens search and finds a post', { tag: '@drafts' }, async ({ page }) => {
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

// Catches `/` taken from someone typing in a field, or from a browser shortcut that adds a
// modifier to it.
test('/ is left alone while typing and with a modifier', async ({ page }) => {
  await page.goto('/about');
  await expect(page.getByRole('button', { name: /search/i })).toBeVisible();
  const dialog = page.getByRole('dialog', { name: 'Search' });
  for (const key of ['Alt+/', 'Control+/', 'Meta+/']) await page.keyboard.press(key);
  await page.evaluate(() =>
    document.querySelector('main')?.prepend(document.createElement('input'))
  );
  await page.locator('main input').first().focus();
  await page.keyboard.press('/');
  await expect(page.locator('main input').first()).toHaveValue('/');
  await expect(dialog).toBeHidden();
});

// Catches `/` and `?` lost on layouts that type them with AltGr, which Windows reports as
// Ctrl+Alt (Brazilian ABNT2: AltGr+Q is `/`).
test('/ and ? typed with AltGr still work', async ({ page }) => {
  await page.goto('/about');
  await expect(page.getByRole('button', { name: /search/i })).toBeVisible();
  const altGr = (key: string) =>
    page.evaluate((key) => {
      const init = { key, ctrlKey: true, altKey: true, modifierAltGraph: true, bubbles: true };
      document.body.dispatchEvent(new KeyboardEvent('keydown', init));
    }, key);
  await altGr('?');
  const keys = page.getByRole('dialog', { name: 'Keyboard' });
  await expect(keys).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(keys).toBeHidden();
  await altGr('/');
  await expect(page.getByRole('dialog', { name: 'Search' })).toBeVisible();
});

// Catches the hint naming `/` while single-key shortcuts are off and `/` does nothing.
test('the hint names the key that opens search', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/about');
  const button = page.getByRole('button', { name: /search/i });
  await expect(button).toHaveAccessibleName('Search /');
  await page.evaluate(() => {
    document.documentElement.dataset.shortcuts = 'off';
  });
  await expect(button).toHaveAccessibleName('Search Ctrl K');
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

test('the open search dialog keeps 24px targets and fits a 320px screen', {
  tag: '@drafts',
}, async ({ page }) => {
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
