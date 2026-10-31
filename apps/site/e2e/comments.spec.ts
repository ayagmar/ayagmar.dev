// Comments under posts and notes (ADR 0036). giscus.app is never reached: every request to it is
// answered by a stub widget that posts what the real one does (its height) and records what the
// page sends it.
import AxeBuilder from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';
import { expect, test } from './fixtures.ts';

// A placeholder draft, so these tests run on the drafts build.
const post = '/writing/token-logs';
const frames = (page: Page) => page.locator('[data-comments-frame] iframe');
const press = (page: Page) => page.getByRole('button', { name: 'Show comments' });

const widget = `<!doctype html><title>stub</title><script>
  window.received = [];
  addEventListener('message', (event) => received.push(event.data));
  // After the load event, as the real widget answers; a frame still loading would be replaced.
  // A stored sign-in is answered the way giscus rejects an expired one.
  addEventListener('load', () =>
    setTimeout(() =>
      parent.postMessage(
        location.search.includes('session=EXPIRED')
          ? { giscus: { error: 'Bad credentials' } }
          : { giscus: { resizeHeight: 320 } },
        '*'
      )
    )
  );
</script>`;

/** Answers the widget request, once `release` is called when `hold` is set. */
async function stubGiscus(page: Page, { hold = false } = {}) {
  const requests: string[] = [];
  let release = () => {};
  const gate = hold ? new Promise<void>((resolve) => (release = resolve)) : undefined;
  await page.route('https://giscus.app/**', async (route: Route) => {
    requests.push(route.request().url());
    await gate;
    await route.fulfill({ contentType: 'text/html', body: widget });
  });
  return { requests, release };
}

const widgetFrame = (page: Page) =>
  page
    .frames()
    .find(
      (frame) => URL.canParse(frame.url()) && new URL(frame.url()).origin === 'https://giscus.app'
    );

const received = (page: Page) =>
  widgetFrame(page)?.evaluate(() => (window as unknown as { received: unknown[] }).received);

test('nothing from giscus.app loads until the button is pressed, then one frame loads', {
  tag: '@drafts',
}, async ({ page }) => {
  const { requests } = await stubGiscus(page);
  await page.goto(post);
  await expect(press(page)).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(requests).toEqual([]);
  await press(page).click();
  await expect(frames(page)).toHaveCount(1);
  await expect(frames(page)).toHaveAttribute('src', /^https:\/\/giscus\.app\/en\/widget\?/);
  // Without it the copy button on a code block in a comment fails.
  await expect(frames(page)).toHaveAttribute('allow', 'clipboard-write');
  const url = new URL((await frames(page).getAttribute('src')) ?? '');
  expect(url.searchParams.get('term')).toBe('writing/token-logs');
  expect(url.searchParams.get('origin')).toBe(`${new URL(page.url()).origin}${post}#comments`);
  await expect.poll(async () => await frames(page).evaluate((f) => f.style.height)).toBe('320px');
});

// Catches a double press (or the OAuth return opening it again) stacking a second thread.
test('pressing the button twice leaves one frame', { tag: '@drafts' }, async ({ page }) => {
  await stubGiscus(page);
  await page.goto(post);
  await expect(press(page)).toBeVisible();
  // Both presses in one task: the button is gone after the first one for a real reader, so this
  // is the guard in the script itself (a keyboard repeat, or the sign-in return).
  await press(page).evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect(frames(page)).toHaveCount(1);
});

// Catches the theme being read once at press time: a reader who switches while the frame loads
// would get a light thread on a night page.
test('a theme switch before the frame has loaded still reaches it', { tag: '@drafts' }, async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  const { requests, release } = await stubGiscus(page, { hold: true });
  await page.goto(post);
  await expect(press(page)).toBeVisible();
  await press(page).click();
  await expect.poll(() => requests.length).toBe(1);
  await page.locator('[data-theme-choice="night"]').click();
  release();
  await expect(frames(page)).toHaveCount(1);
  expect(new URL(requests[0] ?? '').searchParams.get('theme')).toBe('noborder_light');
  await expect
    .poll(() => received(page))
    .toContainEqual({
      giscus: { setConfig: { theme: 'noborder_dark' } },
    });
});

// Catches the thread staying in the old theme after the reader switches, including by system.
test('the open thread follows the switch and the system preference', { tag: '@drafts' }, async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await stubGiscus(page);
  await page.goto(post);
  await expect(press(page)).toBeVisible();
  await press(page).click();
  await expect.poll(() => frames(page).evaluate((f) => f.style.height)).toBe('320px');
  await page.locator('[data-theme-choice="night"]').click();
  await expect
    .poll(() => received(page))
    .toContainEqual({
      giscus: { setConfig: { theme: 'noborder_dark' } },
    });
  await page.locator('[data-theme-choice="auto"]').click();
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.emulateMedia({ colorScheme: 'light' });
  await expect
    .poll(async () => (await received(page))?.at(-1))
    .toEqual({
      giscus: { setConfig: { theme: 'noborder_light' } },
    });
});

// Catches messages from the page itself, or malformed ones from the widget, resizing the window.
test("messages that are not the widget's are ignored", { tag: '@drafts' }, async ({ page }) => {
  await stubGiscus(page);
  await page.goto(post);
  await expect(press(page)).toBeVisible();
  await press(page).click();
  await expect.poll(() => frames(page).evaluate((f) => f.style.height)).toBe('320px');
  await page.evaluate(() => window.postMessage({ giscus: { resizeHeight: 999 } }, '*'));
  await widgetFrame(page)?.evaluate(() => {
    for (const data of [
      { giscus: { resizeHeight: 'tall' } },
      { giscus: { resizeHeight: -1 } },
      'x',
    ])
      parent.postMessage(data, '*');
  });
  await page.waitForTimeout(200);
  expect(await frames(page).evaluate((f) => f.style.height)).toBe('320px');
});

// Catches the window staying on "Loading" forever, or the page shifting when it gives up.
test('a blocked giscus.app says so, keeps the link and moves nothing', { tag: '@drafts' }, async ({
  page,
}) => {
  await page.route('https://giscus.app/**', (route) => route.abort());
  await page.clock.install();
  await page.goto(post);
  await expect(press(page)).toBeVisible();
  const footer = page.locator('.site-footer');
  await press(page).click();
  await expect(page.getByRole('status')).toHaveText('Loading comments…');
  const loading = (await footer.boundingBox())?.y;
  await page.clock.runFor(10_500);
  await expect(page.getByRole('status')).toHaveText(/could not load/);
  expect((await footer.boundingBox())?.y).toBe(loading);
  await expect(page.getByRole('link', { name: 'Open the discussion on GitHub' })).toBeVisible();
});

// Catches a slow widget that answers after the window gave up staying hidden behind the error.
test('a late answer replaces the error message', { tag: '@drafts' }, async ({ page }) => {
  const { release } = await stubGiscus(page, { hold: true });
  await page.clock.install();
  await page.goto(post);
  await expect(press(page)).toBeVisible();
  await press(page).click();
  await page.clock.runFor(10_500);
  await expect(page.getByRole('status')).toHaveText(/could not load/);
  release();
  await expect(page.getByRole('status')).toBeHidden();
  await expect.poll(() => frames(page).evaluate((f) => f.style.height)).toBe('320px');
});

// Catches a restored page, or going back, opening a second frame.
test('returning to the page does not duplicate the frame', { tag: '@drafts' }, async ({ page }) => {
  await stubGiscus(page);
  await page.goto(post);
  await expect(press(page)).toBeVisible();
  await press(page).click();
  await expect(frames(page)).toHaveCount(1);
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
  );
  await expect(frames(page)).toHaveCount(1);
  await page.goto('/writing');
  await page.goBack();
  await expect(press(page)).toBeVisible();
  expect(await frames(page).count()).toBeLessThanOrEqual(1);
  await press(page).click();
  await expect(frames(page)).toHaveCount(1);
});

test('without JavaScript the window offers the discussion on GitHub and no frame', {
  tag: '@drafts',
}, async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(post);
  const section = page.getByRole('region', { name: 'Comments' });
  await expect(section.getByRole('button')).toBeHidden();
  await expect(frames(page)).toHaveCount(0);
  const href = (await section.getByRole('link').getAttribute('href')) ?? '';
  expect(new URL(href).searchParams.get('discussions_q')).toBe(
    'category:Comments in:title "writing/token-logs"'
  );
  await context.close();
});

for (const colorScheme of ['light', 'dark'] as const) {
  // Catches the closed window failing contrast or naming rules in one theme; the third-party
  // frame is not scanned.
  test(`a post with the comments window closed has no axe violations in ${colorScheme}`, {
    tag: '@drafts',
  }, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto(post);
    await expect(press(page)).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
      .analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.length} nodes`)).toEqual([]);
  });
}

// Catches the window, open or failed, pushing the page sideways or the header onto two rows.
test('at 320px the open window does not overflow and the header stays one row', {
  tag: '@drafts',
}, async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await stubGiscus(page);
  await page.goto(post);
  await expect(press(page)).toBeVisible();
  await press(page).click();
  await expect.poll(() => frames(page).evaluate((f) => f.style.height)).toBe('320px');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);
  expect((await page.locator('.site-header').boundingBox())?.height).toBeLessThan(64);
});

// Catches Back after an expired sign-in: assigning the frame's src adds a history entry, and
// going back would put the rejected session into the frame again.
test('reloading the frame after an expired sign-in adds no history entry', {
  tag: '@drafts',
}, async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('giscus-session', '"EXPIRED"'));
  await stubGiscus(page);
  await page.goto(post);
  await expect(press(page)).toBeVisible();
  const before = await page.evaluate(() => history.length);
  await press(page).click();
  await expect.poll(() => frames(page).evaluate((f) => f.style.height)).toBe('320px');
  expect(new URL((await widgetFrame(page)?.url()) ?? '').searchParams.get('session')).toBe('');
  expect(await page.evaluate(() => localStorage.getItem('giscus-session'))).toBeNull();
  expect(await page.evaluate(() => history.length)).toBe(before);
});
