// The room's scrub (ADR 0044). The e2e build runs in fixtures mode, whose month blocks are the
// build's own `/sample/days` files, so these tests watch and hold real requests.
import type { Page, Request } from '@playwright/test';
import { expect, expectNoAxeViolations, test } from './fixtures.ts';

// A day of the fixtures' last block, all four series known; clock fixed so "days back" is stable.
const now = '2026-10-27T12:00:00Z';
const slider = (page: Page) => page.getByRole('slider', { name: 'Go back through past days' });
const scrub = (page: Page) => page.locator('.room-scrub');

async function open(page: Page) {
  await page.clock.setFixedTime(now);
  const requests: Request[] = [];
  page.on('request', (request) => {
    if (/\/sample\/days\/|\/day\/index\.json|room-scrub/.test(request.url()))
      requests.push(request);
  });
  await page.goto('/');
  return requests;
}

/** Everything the scene holds, its attributes in any order. */
const drawing = (page: Page) =>
  page.locator('.scene').evaluate((scene) => ({
    attributes: [...scene.attributes].map(({ name, value }) => `${name}=${value}`).sort(),
    html: scene.innerHTML,
  }));

/** Holds the slider `back` days from now, by the browser's own keys. */
async function goBack(page: Page, back: number) {
  await slider(page).focus();
  for (let press = 0; press < back; press++) await page.keyboard.press('ArrowLeft');
}

// Catches a first load that pays for the scrub, in code or data.
test('asks for nothing until the control is touched', async ({ page }) => {
  const requests = await open(page);
  await expect(slider(page)).toHaveAttribute('aria-valuetext', 'Now');
  await page.waitForLoadState('networkidle');
  expect(requests.map((request) => request.url())).toEqual([]);

  await slider(page).focus();
  await expect.poll(() => requests.some((r) => r.url().includes('room-scrub'))).toBe(true);
  await page.waitForLoadState('networkidle');
  expect(requests.filter((r) => r.url().includes('/sample/days/'))).toEqual([]);
});

// Catches keys that do not reach the date, a label that lags it, and the room left as it was.
test('moves a day at a time by keyboard and says the date', async ({ page }) => {
  await open(page);
  await goBack(page, 11);
  await expect(slider(page)).toHaveAttribute('aria-valuetext', 'Friday 16 October');
  await expect(scrub(page).locator('.room-scrub-date')).toHaveText('Friday 16 October');
  await expect(scrub(page).locator('.room-scrub-facts li').nth(2)).toContainText(' on 16 Oct');
  await expect(page.locator('[data-room="record-player"] span')).toContainText('Last played');
  await expect(page.locator('.scene')).toHaveAttribute('data-sky', 'night');
  await expect(page.getByRole('link', { name: 'Read this day' })).toHaveAttribute(
    'href',
    '/day/2026-10-16'
  );

  await page.keyboard.press('ArrowRight');
  await expect(slider(page)).toHaveAttribute('aria-valuetext', 'Saturday 17 October');

  await page.keyboard.press('Home');
  await expect(slider(page)).toHaveAttribute('aria-valuetext', /2025$/);
  await page.keyboard.press('End');
  await expect(slider(page)).toHaveAttribute('aria-valuetext', 'Now');
});

// Catches the keys 1 to 7 leaving the page from the slider, where a reader's hand already is.
test('keeps the object keys out of the slider', async ({ page }) => {
  await open(page);
  await goBack(page, 2);
  await page.keyboard.press('3');
  await expect(page).toHaveURL(/\/$/);
});

// Catches anything of a past day left in the room: the pins, the screen, the shelf, the window,
// the hotspots and the words must be what they were, to the character.
test('returns to the room exactly as it was', async ({ page }) => {
  await open(page);
  // The first frame's redraw has run once the window has its label.
  await expect(page.locator('.room-window')).toHaveAttribute('aria-label', /Through the window/);
  const before = await drawing(page);
  await goBack(page, 11);
  await expect(scrub(page).locator('.room-scrub-facts li').first()).toContainText('16 Oct');
  await expect.poll(() => drawing(page)).not.toEqual(before);

  await page.getByRole('button', { name: 'Back to now' }).click();
  await expect(slider(page)).toHaveAttribute('aria-valuetext', 'Now');
  await expect(slider(page)).toBeFocused();
  await expect(page.locator('.room-scrub-facts')).toBeHidden();
  await expect(page.getByRole('link', { name: 'Read this day' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Back to now' })).toBeHidden();
  expect(await drawing(page)).toEqual(before);
});

// Catches a slow month painting over the room once the reader has left the date.
test('drops an answer that comes after the return to now', async ({ page }) => {
  let release = () => {};
  const held = new Promise<void>((done) => {
    release = done;
  });
  await page.route('**/sample/days/**', async (route) => {
    await held;
    await route.continue();
  });
  await open(page);
  await expect(page.locator('.room-window')).toHaveAttribute('aria-label', /Through the window/);
  const before = await drawing(page);
  await goBack(page, 11);
  await expect(scrub(page).locator('.room-scrub-facts li').first()).toHaveText('Reading…');
  await page.waitForTimeout(300);
  await page.keyboard.press('End');
  release();
  await page.waitForLoadState('networkidle');
  expect(await drawing(page)).toEqual(before);
});

// Catches one failed source taking the others with it, or reading as a day with nothing in it.
test('names what could not be read and draws the rest', async ({ page }) => {
  await page.route('**/sample/days/listening/**', (route) => route.abort());
  await open(page);
  await goBack(page, 11);
  const facts = scrub(page).locator('.room-scrub-facts li');
  await expect(facts.nth(2)).toHaveText('Listening for 16 Oct could not be read');
  await expect(facts.nth(1)).toContainText('tokens on record for 16 Oct');
});

// Catches an announcement per key press, and a settled date that says nothing.
test('announces once, after the date settles', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const status = document.querySelector('.room-scrub [role="status"]') as HTMLElement;
    window.said = [];
    new MutationObserver(() => window.said.push(status.textContent ?? '')).observe(status, {
      childList: true,
    });
  });
  await goBack(page, 11);
  await expect
    .poll(() => page.evaluate(() => window.said), { timeout: 5_000 })
    .toEqual([expect.stringMatching(/^Friday 16 October\. /)]);
});

declare global {
  interface Window {
    said: string[];
  }
}

// Catches a deploy or a dropped connection on first touch leaving a slider that moves and does
// nothing: the room stays live, the control says so, and the next touch asks again.
test('survives a failed load of its code', async ({ page }) => {
  let blocked = true;
  await page.route('**/_astro/room-scrub.*.js', (route) =>
    blocked ? route.abort() : route.continue()
  );
  await open(page);
  await expect(page.locator('.room-window')).toHaveAttribute('aria-label', /Through the window/);
  const before = await drawing(page);
  await goBack(page, 1);
  await expect(page.getByRole('alert').filter({ hasText: 'could not be loaded' })).toBeVisible();
  await expect(slider(page)).toHaveValue('0');
  await expect(slider(page)).toHaveAttribute('aria-valuetext', 'Now');
  expect(await drawing(page)).toEqual(before);

  blocked = false;
  await page.keyboard.press('ArrowLeft');
  await expect(slider(page)).toHaveAttribute('aria-valuetext', 'Monday 26 October');
  await expect(page.locator('.room-scrub-failed')).toBeHidden();
});

// Catches the scrub on a browser whose zone rules still run Morocco at +01: at 23:30 UTC it thinks
// tomorrow has begun, so today would be offered as a finished day.
test("offers no past days without Rabat's current rules", async ({ page }) => {
  await page.addInitScript(() => {
    const parts = Intl.DateTimeFormat.prototype.formatToParts;
    Intl.DateTimeFormat.prototype.formatToParts = function (time) {
      const old = this.resolvedOptions().timeZone === 'Africa/Casablanca';
      return parts.call(this, old ? Number(time) + 3_600_000 : time);
    };
  });
  await page.clock.setFixedTime('2026-11-06T23:30:00Z');
  await page.goto('/');
  await expect(page.locator('.room-window')).toHaveAttribute('aria-label', /Through the window/);
  await expect(page.locator('.room-scrub')).toHaveCount(0);
});

// Catches a control shown to a reader it cannot work for.
test('has no control without JavaScript', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(`${baseURL}/`);
  await expect(page.locator('.room-scrub')).toBeHidden();
  await context.close();
});

// Catches the control pushing a phone sideways, and a thumb too small for a finger.
test('fits a 360 px phone with room for a finger', async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    viewport: { width: 360, height: 740 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.clock.setFixedTime(now);
  await page.goto(`${baseURL}/`);
  const box = await slider(page).boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(24);
  await goBack(page, 11);
  await expect(page.locator('.room-scrub-facts')).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBe(0);
  await context.close();
});

// Catches a control or a past day that axe finds a fault in, in either theme.
for (const colorScheme of ['light', 'dark'] as const) {
  test(`passes axe on a past day in the ${colorScheme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await open(page);
    await goBack(page, 11);
    await expect(scrub(page).locator('.room-scrub-facts li').nth(2)).toContainText('16 Oct');
    await expectNoAxeViolations(page, '.room-scrub');
  });
}
