import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';

// The page background of each theme (--ground in base.css).
const ground = { day: 'rgb(236, 226, 207)', night: 'rgb(12, 11, 20)' } as const;

const background = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);

// The background recorded in the page's first animation frame, which can run after goto() ends.
const firstFrame = async (page: Page) => {
  await page.waitForFunction(() => typeof window.firstFrame === 'string');
  return page.evaluate(() => window.firstFrame);
};

declare global {
  interface Window {
    firstFrame: string;
  }
}

for (const { system, choice } of [
  { system: 'light', choice: 'night' },
  { system: 'dark', choice: 'day' },
] as const) {
  // Catches a choice that is not stored, not read on the next page, or applied only after the
  // page has painted once in the system theme (a flash).
  test(`a ${choice} choice on a ${system} system holds across pages from the first frame`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: system });
    await page.addInitScript(() => {
      requestAnimationFrame(() => {
        window.firstFrame = getComputedStyle(document.documentElement).backgroundColor;
      });
    });
    await page.goto('/');
    const systemTheme = system === 'light' ? 'day' : 'night';
    expect(await background(page)).toBe(ground[systemTheme]);

    const theme = page.getByRole('group', { name: 'Theme' });
    await theme.getByRole('button', { name: choice }).click();
    await expect(theme.getByRole('button', { pressed: true })).toHaveText(new RegExp(choice, 'i'));
    expect(await background(page)).toBe(ground[choice]);

    await page.goto('/writing/token-logs');
    expect(await firstFrame(page)).toBe(ground[choice]);
    await expect(theme.getByRole('button', { pressed: true })).toHaveText(new RegExp(choice, 'i'));

    // Auto forgets the choice: the next page follows the system again.
    await theme.getByRole('button', { name: 'Auto' }).click();
    await page.goto('/about');
    expect(await firstFrame(page)).toBe(ground[systemTheme]);
  });
}

// Catches a switch that shows up but cannot work, or a page that needs JavaScript for its theme.
test('without JavaScript the page follows the system theme and hides the switch', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false, colorScheme: 'dark' });
  const page = await context.newPage();
  await page.goto(`${baseURL}/`);
  expect(await background(page)).toBe(ground.night);
  await expect(page.getByRole('group', { name: 'Theme' })).toBeHidden();
  await context.close();
});

// Catches both scenes downloading when the stored choice differs from the system, and italic
// text on home, which puts a third font in front of the scene and pushes mobile LCP past 2 s.
test('home loads one scene and two fonts', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/about');
  await page.evaluate(() => localStorage.setItem('theme', 'day'));
  await page.goto('/');
  await page.waitForLoadState('load');
  const assets = await page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .map((entry) => entry.name.match(/\/_astro\/([\w-]+)\.[\w-]+\.(?:png|woff2)$/)?.[1])
      .filter((name) => name !== undefined)
      .sort()
  );
  expect(assets).toEqual(['mono', 'room-day', 'serif-roman']);
});

const roomLinks = (page: Page) =>
  page.locator('.scene a').evaluateAll((links) => links.map((link) => link.getAttribute('href')));

// Catches a hotspot and the list drifting apart, a destination that does not exist, and
// hotspots too small to hit (WCAG 2.2 target size) or covering the list on narrow phones.
test('the hotspots and the list reach the same pages', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  const list = await page
    .getByRole('navigation', { name: 'The room as a list' })
    .getByRole('link')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href')));
  expect(list).toHaveLength(7);
  expect(await roomLinks(page)).toEqual(list);

  for (const href of new Set(list)) {
    const [path = '', id] = (href ?? '').split('#');
    const response = await request.get(path);
    expect(response.status(), href ?? '').toBe(200);
    if (id !== undefined) expect(await response.text(), href ?? '').toContain(`id="${id}"`);
  }

  for (const width of [360, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    for (const hotspot of await page.locator('.scene a').all()) {
      await expect(hotspot).toHaveAccessibleName(/.+: .+/);
      const box = await hotspot.boundingBox();
      expect(box?.width, `${width}px`).toBeGreaterThanOrEqual(24);
      expect(box?.height, `${width}px`).toBeGreaterThanOrEqual(24);
    }
  }
  await page.setViewportSize({ width: 320, height: 800 });
  await expect(page.locator('.scene a').first()).toBeHidden();
});

for (const path of ['/', '/writing/token-logs', '/about', '/stats']) {
  // Catches text or links that lose contrast in the night theme (pages.spec.ts checks the day).
  test(`${path} has no axe violations at night`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto(path);
    await expect(page.getByRole('button', { name: /search/i })).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
      .analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.length} nodes`)).toEqual([]);
  });
}

// Catches motion that keeps running for people who asked for less.
test('reduced motion stops the lamp and the record', async ({ page }) => {
  const animations = () =>
    page.evaluate(() =>
      ['.room-art.night', '.disc'].map(
        (selector) => getComputedStyle(document.querySelector(selector) as Element).animationName
      )
    );
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'no-preference' });
  await page.goto('/');
  expect(await animations()).toEqual(['lamp-on', 'spin']);
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  expect(await animations()).toEqual(['none', 'none']);
});
