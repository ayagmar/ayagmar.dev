// /now and reply by email (ADR 0035). The page itself is also in the sitemap, so e2e/pages.spec.ts
// runs axe on it at 360 and 1280 px and checks it does not scroll sideways at 320 px.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures.ts';

const updated = '2026-10-30';

for (const colorScheme of ['light', 'dark'] as const) {
  // Catches a window or notice whose text fails contrast in one theme, which axe cannot see on
  // the gradient of the page alone; the stale notice is shown so it is checked too.
  test(`/now has no axe violations in ${colorScheme}, stale notice included`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.clock.setFixedTime('2027-06-01T12:00:00Z');
    await page.goto('/now');
    await expect(page.getByRole('button', { name: /search/i })).toBeVisible();
    await expect(page.getByText(/may be out of date/)).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
      .analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.length} nodes`)).toEqual([]);
  });
}

// Catches the header growing a second row at 320 px if /now is ever added to the nav.
test('the header is one row at 320px and /now is not in the nav', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/now');
  await expect(page.getByRole('button', { name: /search/i })).toBeVisible();
  expect((await page.locator('.site-header').boundingBox())?.height).toBeLessThan(64);
  await expect(page.locator('#site-menu').getByRole('link', { name: 'Now' })).toHaveCount(0);
});

test('/now shows its items, linked, with the date and no JavaScript needed', async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/now');
  const window = page.getByRole('region', { name: 'Currently brewing' });
  await expect(window.getByRole('link', { name: 'repo-pulse' })).toHaveAttribute(
    'href',
    'https://github.com/ayagmar/repo-pulse'
  );
  // An item without a url is text, not a dead link.
  await expect(window.getByText('this site')).toBeVisible();
  await expect(window.getByRole('link', { name: 'this site' })).toHaveCount(0);
  await expect(page.locator('main time')).toHaveAttribute('datetime', updated);
  await context.close();
});

// Catches the notice using the build's clock (a page built fresh and served stale claims
// freshness), showing for a fresh page, or flipping on the wrong side of the 90-day line.
test.describe('the out-of-date notice follows the reader clock', () => {
  const cases = [
    ['90 days after', '2027-01-28T00:00:00Z', false],
    ['91 days after', '2027-01-29T00:00:01Z', true],
    ['the day of', '2026-10-30T12:00:00Z', false],
  ] as const;
  for (const [name, time, shown] of cases) {
    test(`${name} the update: ${shown ? 'shown' : 'hidden'}`, async ({ page }) => {
      await page.clock.setFixedTime(time);
      await page.goto('/now');
      await expect(page.getByText(/may be out of date/)).toBeVisible({ visible: shown });
    });
  }
});

// Catches the notice being decided once at load: a tab left open, or a page restored from the
// back/forward cache, crosses the 90-day line while no script runs again. The clock is installed
// so timers are fake; setSystemTime jumps it without firing any, so an event alone must do it.
test.describe('the out-of-date notice follows the clock while the page stays', () => {
  const notice = (page: import('@playwright/test').Page) => page.getByText(/may be out of date/);
  const lastFresh = '2027-01-27T23:59:59Z';
  const stale = '2027-01-28T00:00:02Z';

  // Catches the threshold passing with the page open and nothing noticing.
  test('appears when the 90 days run out while the page is open', async ({ page }) => {
    await page.clock.install({ time: lastFresh });
    await page.goto('/now');
    await expect(notice(page)).toBeHidden();
    await page.clock.runFor(3000);
    await expect(notice(page)).toBeVisible();
  });

  const returns = {
    'a page restored from history (persisted pageshow)': () =>
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })),
    'the window regaining focus': () => window.dispatchEvent(new Event('focus')),
    'the tab becoming visible': () => document.dispatchEvent(new Event('visibilitychange')),
  };
  for (const [name, event] of Object.entries(returns)) {
    // Catches a returning reader seeing no warning on a page that is now old, and a warning that
    // stays after the reader's clock is corrected.
    test(`follows the clock both ways on ${name}`, async ({ page }) => {
      await page.clock.install({ time: lastFresh });
      await page.goto('/now');
      await expect(notice(page)).toBeHidden();
      await page.clock.setSystemTime(stale);
      await page.evaluate(event);
      await expect(notice(page)).toBeVisible();
      await page.clock.setSystemTime(lastFresh);
      await page.evaluate(event);
      await expect(notice(page)).toBeHidden();
    });
  }
});

test('the footer, /about and index.txt link /now; the sitemap lists it', async ({
  page,
  request,
}) => {
  await page.goto('/about');
  await expect(page.locator('.site-footer').getByRole('link', { name: 'Now' })).toHaveAttribute(
    'href',
    '/now'
  );
  await expect(page.locator('.paper').getByRole('link', { name: 'Now' })).toHaveAttribute(
    'href',
    '/now'
  );
  await expect(page.getByRole('link', { name: 'hello@ayagmar.dev' })).toHaveAttribute(
    'href',
    'mailto:hello@ayagmar.dev'
  );
  expect(await (await request.get('/index.txt')).text()).toContain('https://ayagmar.dev/now');
  expect(await (await request.get('/sitemap-0.xml')).text()).toContain(
    '<loc>https://ayagmar.dev/now</loc>'
  );
});

// Catches a title character cutting the subject short, or the link missing from a real page.
test('a post links "Reply by email" with its title as the subject', { tag: '@drafts' }, async ({
  page,
}) => {
  await page.goto('/writing/token-logs');
  const title = (await page.getByRole('heading', { level: 1 }).textContent())?.trim();
  const href = await page.getByRole('link', { name: 'Reply by email' }).getAttribute('href');
  expect(href?.startsWith('mailto:hello@ayagmar.dev?subject=')).toBe(true);
  expect(decodeURIComponent((href ?? '').split('subject=')[1] ?? '')).toBe(`Re: ${title}`);
});

// Catches reply links reaching feed items, which would show every item as updated in readers.
test('the feeds do not carry the reply link', { tag: '@drafts' }, async ({ request }) => {
  for (const feed of ['/feed.xml', '/atom.xml', '/til/feed.xml', '/til/atom.xml']) {
    expect(await (await request.get(feed)).text(), feed).not.toContain('mailto:');
  }
});
