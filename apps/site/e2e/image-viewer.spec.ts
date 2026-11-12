// The image viewer (ADR 0049): project screenshots and the Noctalia plugins' screenshots open in
// one dialog on the page instead of navigating to the file.
import type { Page } from '@playwright/test';
import { expect, expectNoAxeViolations, test } from './fixtures.ts';

const viewer = (page: Page) => page.locator('dialog.viewer');

const closeBy = {
  button: async (page: Page) => {
    await viewer(page).getByRole('button', { name: 'Close' }).click();
  },
  escape: async (page: Page) => {
    await page.keyboard.press('Escape');
  },
  backdrop: async (page: Page) => {
    await page.mouse.click(4, 300);
  },
  back: async (page: Page) => {
    await page.goBack();
  },
};

for (const [route, close] of Object.entries(closeBy)) {
  // Catches a way out of the viewer that leaves it open, loses the reader's place (focus not back
  // on the screenshot, the page left scrolled-locked) or leaves a history entry that Back then
  // spends on nothing: after closing, Back must leave the page.
  test(`the viewer closes by ${route}, gives focus back and leaves history as it was`, async ({
    page,
  }) => {
    await page.goto('/projects');
    await page.goto('/projects/pi-extmgr');
    const link = page.locator('.project-shot a');
    await link.click();
    await expect(viewer(page)).toHaveAttribute('open', '');
    await expect(viewer(page).getByRole('button', { name: 'Close' })).toBeFocused();
    await expect(page.locator('html')).toHaveCSS('overflow', 'hidden');
    await close(page);
    await expect(viewer(page)).not.toHaveAttribute('open');
    await expect(page).toHaveURL(/\/projects\/pi-extmgr$/);
    await expect(link).toBeFocused();
    await expect(page.locator('html')).not.toHaveCSS('overflow', 'hidden');
    await expect.poll(() => page.evaluate(() => history.state)).toBeNull();
    await page.goBack();
    await expect(page).toHaveURL(/\/projects$/);
  });
}

// Catches the viewer showing the thumbnail-sized file, the other theme's version of a pair, an
// image stretched past its own pixels, or navigation on a page with one image.
test('a screenshot opens large, in the version for the theme, with no navigation', async ({
  browser,
}) => {
  const context = await browser.newContext({
    colorScheme: 'dark',
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  await page.goto('/projects/runnerd');
  await page.locator('.project-shot a:visible').click();
  const image = viewer(page).locator('img');
  await expect(image).toHaveJSProperty('complete', true);
  const shown = await image.evaluate((img: HTMLImageElement) => ({
    file: img.currentSrc,
    width: img.getBoundingClientRect().width,
  }));
  expect(shown.file).toMatch(/\/_astro\/runnerd-night\.[\w-]+\.webp$/);
  expect(shown.width).toBeGreaterThan(1000);
  expect(shown.width).toBeLessThanOrEqual(1920);
  await expect(viewer(page).locator('figcaption')).toHaveText(
    "The dashboard's history of the last 30 days: 861 jobs, with charts of jobs per day, run time and wait, and memory peak."
  );
  await expect(viewer(page).getByRole('link', { name: 'Open original' })).toHaveAttribute(
    'href',
    /\/_astro\/runnerd-night\.[\w-]+\.webp$/
  );
  await expect(viewer(page).getByRole('button', { name: 'Next' })).toBeHidden();
  await expect(viewer(page).locator('.viewer-count')).toHaveText('');

  await page.goto('/projects/repo-pulse');
  await expect(viewer(page)).toHaveCount(0);
  expect(await page.locator('script[src*="ImageViewer"]').count()).toBe(0);
  await context.close();
});

// Catches the plugins' screenshots loading with /projects (its weight budget counts on them not
// to), navigation that stops or skips a plugin, or arrow keys that do nothing. It wraps around.
test('the plugin screenshots load only when opened and step through all three', async ({
  page,
}) => {
  const screenshots: string[] = [];
  page.on('request', (request) => {
    if (/-screenshot\./.test(request.url())) screenshots.push(request.url());
  });
  await page.goto('/projects');
  await page.waitForLoadState('networkidle');
  expect(screenshots).toEqual([]);

  await page.getByRole('link', { name: 'A screenshot of Binance' }).click();
  const count = viewer(page).locator('.viewer-count');
  const caption = viewer(page).locator('figcaption');
  await expect(count).toHaveText('2 of 3');
  await expect(caption).toHaveText(/^Binance's overview/);
  await expect(viewer(page).locator('img')).toHaveAttribute('src', /binance-screenshot/);
  await viewer(page).getByRole('button', { name: 'Next' }).click();
  await expect(count).toHaveText('3 of 3');
  await expect(caption).toHaveText(/^The OBS Studio panel/);
  await viewer(page).getByRole('button', { name: 'Next' }).click();
  await expect(count).toHaveText('1 of 3');
  await expect(caption).toHaveText(/^Headroom's panel/);
  await page.keyboard.press('ArrowLeft');
  await expect(count).toHaveText('3 of 3');
  await page.keyboard.press('ArrowRight');
  await expect(count).toHaveText('1 of 3');
  await viewer(page).getByRole('button', { name: 'Previous' }).click();
  await expect(count).toHaveText('3 of 3');
  expect(screenshots.length).toBeGreaterThan(0);
});

// Catches an open viewer that a screen reader or keyboard cannot use: no name, unlabelled
// controls, or contrast that fails in either theme.
for (const scheme of ['light', 'dark'] as const) {
  test(`the open viewer passes axe in the ${scheme} scheme`, async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: scheme });
    const page = await context.newPage();
    await page.goto('/projects');
    await page.getByRole('link', { name: 'A screenshot of Headroom' }).click();
    await expect(viewer(page).locator('img')).toHaveJSProperty('complete', true);
    await expectNoAxeViolations(page, 'dialog.viewer');
    await context.close();
  });
}

// Catches the no-script fallback breaking: without the viewer, a screenshot must still be a link
// that reaches the full-size file.
test('without JavaScript a screenshot is a link to its file', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/projects/pi-extmgr');
  const [response] = await Promise.all([
    page.waitForResponse(/\/_astro\/pi-extmgr\.[\w-]+\.png$/),
    page.locator('.project-shot a').click(),
  ]);
  expect(response.headers()['content-type']).toBe('image/png');
  await expect(page).toHaveURL(/\/_astro\/pi-extmgr\.[\w-]+\.png$/);
  await context.close();
});
