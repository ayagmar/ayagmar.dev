import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';

// The page background of each theme (--ground in base.css).
const ground = { day: 'rgb(239, 227, 203)', night: 'rgb(13, 10, 23)' } as const;

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

// Catches a switch that shows up but cannot work, a page that needs JavaScript for its theme,
// or a room detail that shows a guess without its script.
test('without JavaScript the page follows the system theme and hides the switch', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false, colorScheme: 'dark' });
  const page = await context.newPage();
  await page.goto(`${baseURL}/`);
  expect(await background(page)).toBe(ground.night);
  await expect(page.getByRole('group', { name: 'Theme' })).toBeHidden();
  // The room stays the static night scene: no sky from a clock, no moon, no note.
  await expect(page.locator('.scene')).not.toHaveAttribute('data-sky', /.*/);
  await expect(page.locator('.room-note')).toBeHidden();
  // The keys button would open nothing.
  await expect(page.getByRole('button', { name: 'Keys' })).toBeHidden();
  await context.close();
});

// Catches both scenes downloading when the stored choice differs from the system, more than one
// window layer (ADR 0027), and italic text on home, which puts another font in front of the
// scene and pushes mobile LCP past 2 s. The display face (ADR 0034) is the third, by design.
test('home loads one scene, one window and three fonts', async ({ page }) => {
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
  // Which window depends on the time in Rabat; there is exactly one.
  expect(assets.filter((name) => !name.startsWith('window-'))).toEqual([
    'display',
    'mono',
    'room-day',
    'serif-roman',
  ]);
  expect(assets.filter((name) => name.startsWith('window-'))).toHaveLength(1);
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
  expect(list).toHaveLength(8);
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

// The three posts carry the three kinds of art (ADR 0027): ascii, dither, pattern.
for (const path of [
  '/',
  '/writing/token-logs',
  '/writing/ephemeral-runners',
  '/writing/cache-reads',
  '/about',
  '/stats',
]) {
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

// Catches motion that keeps running for people who asked for less (the record: signals.spec.ts).
test('reduced motion stops the lamp', async ({ page }) => {
  const lamp = () =>
    page.locator('.room-art.night').evaluate((art) => getComputedStyle(art).animationName);
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'no-preference' });
  await page.goto('/');
  expect(await lamp()).toBe('lamp-on');
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  expect(await lamp()).toBe('none');
});

// The room's clock (ADR 0027). The visitor is in Auckland, 13 hours ahead of Rabat, so a
// window that followed the visitor's clock or the page theme would show the wrong sky.
test.describe('the room keeps Rabat time', () => {
  test.use({ timezoneId: 'Pacific/Auckland' });

  const room = (page: Page) =>
    page.locator('.scene').evaluate((scene) => {
      const image = (selector: string) =>
        getComputedStyle(scene.querySelector(selector) as Element).backgroundImage.match(
          /\/_astro\/([\w-]+)\./
        )?.[1] ?? null;
      return {
        sky: scene.getAttribute('data-sky'),
        window: image('.room-window'),
        night: image('.room-art.night'),
        moon: scene.querySelector('.room-moon path')?.getAttribute('d') ?? '',
      };
    });

  const visit = async (page: Page, time: string, colorScheme: 'light' | 'dark') => {
    await page.clock.setFixedTime(time);
    await page.emulateMedia({ colorScheme });
    await page.goto('/');
    await expect(page.locator('.scene')).toHaveAttribute('data-sky', /.+/);
  };

  // 03:00 in Rabat (+00) on the full moon of 26 Oct 2026, a sunny afternoon in Auckland.
  test('at 03:00 the window shows the night and the moon, and the lamp is down', async ({
    page,
  }) => {
    await visit(page, '2026-10-26T03:00:00Z', 'light');
    expect(await room(page)).toMatchObject({ sky: 'night', window: 'window-night' });
    expect((await room(page)).moon).not.toBe('');
    await expect(page.getByRole('img', { name: /night over Rabat, a full moon/ })).toBeVisible();
    await expect(page.locator('.room-note')).toHaveText('Probably asleep: it is 03:00 in Rabat.');

    await page.emulateMedia({ colorScheme: 'dark' });
    expect((await room(page)).night).toBe('room-night-dim');
  });

  test('at noon the window shows the day, with no moon and no note', async ({ page }) => {
    await visit(page, '2026-10-26T12:00:00Z', 'dark');
    expect(await room(page)).toEqual({
      sky: 'day',
      window: 'window-day',
      night: 'room-night',
      moon: '',
    });
    await expect(page.locator('.room-note')).toBeHidden();
  });

  // Catches a browser whose tzdata predates 2026c dimming the lamp on the wrong hour: it still
  // puts Rabat at +01, so at 01:30 there it would say 02:30 and show "probably asleep".
  // The sky and the moon come from UTC and stay.
  test('with outdated time zone rules the lamp stays on and no note shows', async ({ page }) => {
    await page.addInitScript(() => {
      const Original = Intl.DateTimeFormat;
      // Etc/GMT-1 is +01 all year, as Morocco was before the rules changed.
      Intl.DateTimeFormat = class extends Original {
        constructor(locales?: string | string[], options?: Intl.DateTimeFormatOptions) {
          const outdated = options?.timeZone === 'Africa/Casablanca';
          super(locales, outdated ? { ...options, timeZone: 'Etc/GMT-1' } : options);
        }
      } as typeof Intl.DateTimeFormat;
    });
    await visit(page, '2026-10-26T01:30:00Z', 'dark');
    expect(await room(page)).toMatchObject({
      sky: 'night',
      window: 'window-night',
      night: 'room-night',
    });
    expect((await room(page)).moon).not.toBe('');
    await expect(page.locator('.room-note')).toBeHidden();
  });

  test('just after sunset the window shows dusk', async ({ page }) => {
    await visit(page, '2026-10-26T17:55:00Z', 'dark');
    expect(await room(page)).toMatchObject({ sky: 'dusk', window: 'window-dusk' });
  });
});

// Catches a key that does nothing, the list missing a key, or the room's keys leaking onto
// pages without the room.
test('? lists the keys, and t and the room numbers work', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  const keys = page.getByRole('dialog', { name: 'Keyboard' });
  await page.keyboard.press('?');
  await expect(keys).toBeVisible();
  await expect(keys.getByText(/^Corkboard: shipping$|^Shelf: reading$/)).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(keys).toBeHidden();

  await page.keyboard.press('t');
  expect(await background(page)).toBe(ground.day);
  await page.keyboard.press('t');
  expect(await background(page)).toBe(ground.night);

  await page.keyboard.press('3');
  await expect(page).toHaveURL(/\/writing$/);
  await page.keyboard.press('?');
  await expect(keys).toBeVisible();
  await expect(keys.getByText('Corkboard: shipping')).toHaveCount(0);
});

// WCAG 2.1.4: single-character shortcuts can be turned off. Catches a switch that does not
// persist to the next page, a bare key that ignores it (?, t, 1 to 7, search's /), and Ctrl K
// switched off with them.
test('the keys switch turns every single-key shortcut off, on every page', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/writing');
  const keys = page.getByRole('dialog', { name: 'Keyboard' });
  const shortcuts = keys.getByRole('switch', { name: /single-key shortcuts/i });
  await page.getByRole('button', { name: 'Keys' }).click();
  await expect(shortcuts).toBeChecked();
  await shortcuts.click();
  await expect(shortcuts).not.toBeChecked();
  await page.keyboard.press('Escape');

  await page.goto('/');
  const search = page.getByRole('dialog', { name: 'Search' });
  await expect(page.getByRole('button', { name: /search/i })).toBeVisible();
  for (const key of ['?', 't', '3', '/']) await page.keyboard.press(key);
  await page.keyboard.press('Control+k');
  await expect(search).toBeVisible();
  await expect(keys).toBeHidden();
  expect(await background(page)).toBe(ground.night);
  expect(new URL(page.url()).pathname).toBe('/');
  await page.keyboard.press('Escape');

  // On again, from the same button, and the keys work again.
  await page.getByRole('button', { name: 'Keys' }).click();
  await expect(shortcuts).not.toBeChecked();
  await shortcuts.click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('t');
  expect(await background(page)).toBe(ground.day);
});

for (const colorScheme of ['light', 'dark'] as const) {
  // Catches a switch without a name or state, or with too little contrast, in either theme.
  test(`the keys dialog has no axe violations (${colorScheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto('/');
    await page.getByRole('button', { name: 'Keys' }).click();
    await expect(page.getByRole('dialog', { name: 'Keyboard' })).toBeVisible();
    const results = await new AxeBuilder({ page })
      .include('dialog.keys')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
      .analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.length} nodes`)).toEqual([]);
  });
}

// Catches art missing from a post that asks for it, or the wrong kind drawn.
test('each post draws the art its frontmatter asks for', async ({ page }) => {
  for (const [path, kind] of [
    ['/writing/token-logs', 'ascii'],
    ['/writing/ephemeral-runners', 'dither'],
    ['/writing/cache-reads', 'pattern'],
  ] as const) {
    await page.goto(path);
    await expect(page.locator(`.post-art svg.art-${kind}`)).toBeVisible();
  }
});
