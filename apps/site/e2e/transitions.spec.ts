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
    /** The pseudo-elements animating once the transition has started. */
    running: string[];
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
        window.running = document.documentElement
          .getAnimations({ subtree: true })
          .flatMap((animation) => (animation.effect as KeyframeEffect).pseudoElement ?? []);
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
// from above the window, and any change of box would morph it.
test('only the page fades, from a scrolled page too', async ({ page }) => {
  await watchReveal(page);
  await page.goto('/');
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  await page.locator('.site-footer a[href="/colophon"]').click();
  await page.waitForFunction(() => window.running !== undefined);
  expect([...new Set(await page.evaluate(() => window.running))].sort()).toEqual([
    '::view-transition-group(root)',
    '::view-transition-new(root)',
    '::view-transition-old(root)',
  ]);
});

// Catches the header moving half a scrollbar sideways between a page that scrolls and one that
// does not, which is the jump a still header exists to avoid.
test('the header keeps its box between pages', async ({ page }) => {
  await page.goto('/');
  const header = page.locator('.site-header');
  const home = await header.boundingBox();
  await page.goto(notFoundPath);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(
    page.viewportSize()?.height
  );
  expect(await header.boundingBox()).toEqual(home);
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
