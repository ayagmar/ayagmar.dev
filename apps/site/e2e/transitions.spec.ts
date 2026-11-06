import { snapshotFixtures } from '@min7/contracts/fixtures';
import type { Page } from '@playwright/test';
import { expect, notFoundPath, test } from './fixtures.ts';

// The page background of each theme (--ground in base.css).
const ground = { day: 'rgb(246, 242, 234)', night: 'rgb(14, 12, 19)' } as const;

// Playwright hides scrollbars; the header test needs them to take up room, as on most desktops.
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

declare global {
  interface Window {
    /** For each `pagereveal` of this document, whether a view transition came with it. */
    revealed: boolean[];
    /** The transition once started: what animates, and the height of the header's capture. */
    running: { animated: string[]; headerHeight: string };
    /** The page background on each of the document's first frames. */
    themeFrames: string[];
  }
}

const watchReveal = (page: Page) =>
  page.addInitScript(() => {
    window.revealed = [];
    addEventListener('pagereveal', (event) => {
      window.revealed.push(event.viewTransition !== null);
      event.viewTransition?.ready.then(() => {
        const root = document.documentElement;
        window.running = {
          animated: root
            .getAnimations({ subtree: true })
            .flatMap((animation) => (animation.effect as KeyframeEffect).pseudoElement ?? []),
          headerHeight: getComputedStyle(root, '::view-transition-group(site-header)').height,
        };
      });
    });
  });

const follow = async (page: Page, href: string) => {
  await page.locator(`.site-header nav a[href="${href}"]`).click();
  await page.waitForURL(`**${href}`);
};

const revealed = async (page: Page) => {
  await page.waitForFunction(() => window.revealed.length > 0);
  return page.evaluate(() => window.revealed);
};

// Catches the rule lost from the stylesheet or dropped by the CSS minifier, which leaves every
// click a plain load with nothing failing.
test('a link between pages runs a view transition', async ({ page }) => {
  await watchReveal(page);
  await page.goto('/');
  await follow(page, '/writing');
  expect(await revealed(page)).toEqual([true]);
});

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  // Catches the rule moved out of its media query: the page would fade for someone who asked
  // for no motion, which the global reduced-motion rule does not reach.
  test('a link between pages runs no transition', async ({ page }) => {
    await watchReveal(page);
    await page.goto('/');
    await follow(page, '/writing');
    expect(await revealed(page)).toEqual([false]);
  });
});

// Catches the header's group animating again: from a page left scrolled down it would slide in
// from above the window. Also its name lost, when it would fade with the page, which no list of
// animations shows: the capture would be gone.
test('only the page fades and the header is captured, from a scrolled page too', async ({
  page,
}) => {
  await watchReveal(page);
  await page.goto('/');
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  await page.locator('.site-footer a[href="/colophon"]').click();
  await page.waitForFunction(() => window.running !== undefined);
  const { animated, headerHeight } = await page.evaluate(() => window.running);
  expect([...new Set(animated)].sort()).toEqual([
    '::view-transition-group(root)',
    '::view-transition-new(root)',
    '::view-transition-old(root)',
  ]);
  const header = await page.locator('.site-header').boundingBox();
  expect(headerHeight).toBe(`${header?.height}px`);
});

for (const width of [1280, 700]) {
  // Catches the header moving half a scrollbar sideways between a page that scrolls and one that
  // does not, which is the jump a still header exists to avoid. Classic scrollbars do not depend
  // on the window's width, so a narrow window counts too.
  test(`the header keeps its box between pages at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/');
    const header = page.locator('.site-header');
    const home = await header.boundingBox();
    await page.goto(notFoundPath);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(1000);
    expect(await header.boundingBox()).toEqual(home);
  });
}

// Catches the link that stands in for search looking different from the button: the unanimated
// new header would show one control and change to another when the island hydrates, up to 2 s
// after the page. The outer header box cannot show this; the control's box and label can.
test('the search control looks the same before and after hydration', async ({ page }) => {
  await page.goto('/about');
  const button = page.getByRole('button', { name: /search/i });
  await expect(button).toBeVisible();
  const hydrated = { box: await button.boundingBox(), label: await button.innerText() };

  let hydrate = () => {};
  const held = new Promise<void>((done) => {
    hydrate = done;
  });
  await page.route(/\/_astro\/Search\.[\w-]+\.js$/, async (route) => {
    await held;
    await route.continue();
  });
  await follow(page, '/writing');
  const link = page.locator('.site-tools a');
  await expect(link).toBeVisible();
  expect({ box: await link.boundingBox(), label: await link.innerText() }).toEqual(hydrated);

  hydrate();
  await expect(button).toBeVisible();
  expect({ box: await button.boundingBox(), label: await button.innerText() }).toEqual(hydrated);
});

// Catches a link to the open page fading: the answer on screen would dissolve into the build's
// older value and then jump back when the new document's own request returns.
test('a link to the open page reloads it without a fade', async ({ page }) => {
  const api = 'https://api.ayagmar.dev/v1/listening';
  await page.clock.install({ time: '2026-10-26T10:31:00Z' });
  await page.route('**/', async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace(
      'data-live="listening"',
      `data-live="listening" data-live-src="${api}"`
    );
    await route.fulfill({ response, body });
  });
  let asked = 0;
  let answer = () => {};
  const held = new Promise<void>((done) => {
    answer = done;
  });
  await page.route(api, async (route) => {
    asked += 1;
    if (asked > 1) await held;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        source: 'listening',
        version: 1,
        fetchedAt: '2026-10-26T10:30:00Z',
        stale: false,
        data: {
          ...snapshotFixtures.listening.ok,
          nowPlaying: { track: 'Which Will', artist: 'Nick Drake', album: null, url: null },
        },
      }),
    });
  });
  await watchReveal(page);
  await page.goto('/');
  const line = page.locator('.now-playing');
  await expect(line).toHaveText('Now playing Which Will by Nick Drake');

  await page.locator('.wordmark').click();
  await expect.poll(() => asked).toBe(2);
  await expect(line).toContainText('Last played Friendships and Love by Rocketship');
  expect(await revealed(page)).toEqual([false]);

  answer();
  await expect(line).toHaveText('Now playing Which Will by Nick Drake');
});

for (const { system, choice } of [
  { system: 'light', choice: 'night' },
  { system: 'dark', choice: 'day' },
] as const) {
  // Catches the new page's snapshot taken before the blocking theme script has run, or a choice
  // lost to a navigation that starts in the same task: either fades through the system theme.
  test(`a ${choice} choice made as a link is followed holds on every frame`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: system });
    await page.addInitScript(() => {
      window.themeFrames = [];
      const record = () => {
        window.themeFrames.push(getComputedStyle(document.documentElement).backgroundColor);
        if (window.themeFrames.length < 15) requestAnimationFrame(record);
      };
      requestAnimationFrame(record);
    });
    await page.goto('/about');
    await page.evaluate((theme) => {
      document.querySelector<HTMLElement>(`[data-theme-choice="${theme}"]`)?.click();
      document.querySelector<HTMLElement>('.site-header nav a[href="/writing"]')?.click();
    }, choice);
    await page.waitForURL('**/writing');
    await page.waitForFunction(() => window.themeFrames?.length === 15);
    expect([...new Set(await page.evaluate(() => window.themeFrames))]).toEqual([ground[choice]]);
  });
}

// Catches a page restored from the back/forward cache keeping the theme it was left with after
// the choice changed on the next page: the switch would disagree with storage and the page
// change would fade into the old theme.
test('a page restored from history takes the choice made since', async ({ page }) => {
  await page.goto('/about');
  await page.evaluate(() => {
    localStorage.setItem('theme', 'day');
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'day');
  await expect(
    page.getByRole('group', { name: 'Theme' }).getByRole('button', { pressed: true })
  ).toHaveText(/day/i);
});
