// "On this day" on /stats (ADR 0030). The e2e build runs in fixtures mode, where the page never
// asks for the history. Each test below gives the block the API endpoint, as an `api` mode
// build would, and answers the API itself from the shared listening-history fixtures, with
// the browser's clock fixed.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';
import { expect, test } from './fixtures.ts';

const api = 'https://api.ayagmar.dev/v1/listening-history';
const minute = 60_000;
// Noon on 2026-10-26 in Rabat (+00).
const noon = '2026-10-26T12:00:00Z';

type Case = 'ok' | 'empty' | 'approximate' | 'ties';

// The shared fixtures (packages/contracts/fixtures/listening-history/snapshot).
const snapshot = (name: Case) =>
  JSON.parse(
    readFileSync(
      join(
        import.meta.dirname,
        '../../../packages/contracts/fixtures/listening-history/snapshot',
        `${name}.json`
      ),
      'utf8'
    )
  ) as Record<string, unknown>;

/** A `/v1/listening-history` answer with `name`'s snapshot, for `describedDate`. */
const envelope = (
  name: Case,
  { describedDate = '2026-10-26', stale = false, data = {} as Record<string, unknown> } = {}
) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({
    source: 'listening-history',
    version: 1,
    fetchedAt: '2026-10-26T00:03:00.000Z',
    stale,
    data: { ...snapshot(name), describedDate, ...data },
  }),
});

/** Opens /stats at `time` with the history endpoint turned on, answered by `answer`. */
async function visit(page: Page, time: string, answer: (route: Route) => unknown) {
  await page.clock.install({ time });
  await page.route('**/stats', async (route) => {
    const response = await route.fetch();
    const html = (await response.text()).replace(
      '<div class="history"',
      `<div class="history" data-history-src="${api}"`
    );
    await route.fulfill({ response, body: html });
  });
  await page.route(api, answer);
  await page.goto('/stats');
}

const block = (page: Page) => page.locator('.history');
const lines = (page: Page) => block(page).locator('li');

// Catches a year, count, title or artist shown wrongly, the years out of order, and a date
// other than the snapshot's.
test('shows each past year with scrobbles on today, newest first', async ({ page }) => {
  await visit(page, noon, (route) => route.fulfill(envelope('ok')));
  await expect(block(page)).toBeVisible();
  await expect(block(page).getByRole('heading', { name: 'On this day' })).toBeVisible();
  await expect(block(page).locator('time')).toHaveAttribute('datetime', '2026-10-26');
  await expect(block(page)).toContainText('On 26 October in past years:');
  await expect(lines(page)).toHaveText([
    '2025: 29 scrobbles. Most played: Nowhere to Run by LTN, 2 times.',
    '2024: 47 scrobbles. Most played: The Less I Know the Better by Tame Impala, 2 times.',
    '2023: 99 scrobbles. Most played: Better Off Alone by Always Mirin, 3 times.',
  ]);
  await expect(block(page).locator('.history-empty')).toBeHidden();
});

// Catches a partly read day presented as complete.
test('marks a top track found among only part of the day', async ({ page }) => {
  await visit(page, noon, (route) => route.fulfill(envelope('approximate')));
  await expect(lines(page).first()).toContainText('450 scrobbles. Most played of the 200 read:');
});

// Catches years without scrobbles listed, or an empty list with no words.
test('says so in one line when no past year has scrobbles today', async ({ page }) => {
  await visit(page, noon, (route) => route.fulfill(envelope('empty')));
  await expect(block(page).locator('.history-empty')).toHaveText(
    'Nothing played on this date in any past year.'
  );
  await expect(block(page).locator('ol')).toBeHidden();
});

// Catches Last.fm's titles and artists treated as markup.
test('shows titles and artists as text, never markup', async ({ page }) => {
  const track = '<img src=x onerror="document.title=1">';
  const artist = '</cite><script>document.title=2</script>';
  await visit(page, noon, (route) =>
    route.fulfill(
      envelope('ok', {
        data: { years: [{ year: 2025, scrobbles: 3, read: 3, top: { track, artist, plays: 2 } }] },
      })
    )
  );
  await expect(lines(page)).toHaveText([
    `2025: 3 scrobbles. Most played: ${track} by ${artist}, 2 times.`,
  ]);
  await expect(block(page).locator('img, script')).toHaveCount(0);
  expect(await page.title()).not.toMatch(/^[12]$/);
});

// Catches the block overflowing a phone, failing axe in either theme, or pushing the page
// around once it fills in. Only that last shift is counted: the fonts swapping in and the
// search island hydrating also move the page, at times that depend on the machine, so the
// answer is held until both are done and the count starts then.
for (const width of [320, 360, 1280]) {
  test(`fits ${width}px, passes axe in both themes and shifts nothing in view`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.addInitScript(() => {
      window.shifts = 0;
      window.shiftObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as (PerformanceEntry & { value: number })[]) {
          window.shifts += entry.value;
        }
      });
      window.shiftObserver.observe({ type: 'layout-shift', buffered: true });
    });
    await visit(page, noon, async (route) => {
      await page.evaluate(async () => {
        await document.fonts.ready;
        // Only the search island: one that hydrates when visible would never end this loop.
        while (document.querySelector('.site-tools astro-island[ssr]')) {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        // A shift is recorded in the frame after the change that causes it.
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        window.shiftObserver.takeRecords();
        window.shifts = 0;
      });
      await route.fulfill(envelope('ok'));
    });
    await expect(lines(page)).toHaveCount(3);
    // Read after the frames in which the fill-in's shift is recorded, with the entries the
    // observer has not delivered yet.
    const shifts = await page.evaluate(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const pending = window.shiftObserver.takeRecords() as (PerformanceEntry & {
        value: number;
      })[];
      return window.shifts + pending.reduce((sum, entry) => sum + entry.value, 0);
    });
    expect(shifts).toBeLessThan(0.01);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      )
    ).toBeLessThanOrEqual(0);
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      const results = await new AxeBuilder({ page })
        .include('.history')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
        .analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.length} nodes`)).toEqual([]);
    }
  });
}

declare global {
  interface Window {
    shifts: number;
    shiftObserver: PerformanceObserver;
    setHidden(hidden: boolean): void;
  }
}

// Catches another day's history shown as today's: a snapshot signals still calls fresh, the
// one a page built yesterday was served with, or one from before the browser's midnight.
for (const [name, describedDate] of [
  ['yesterday', '2026-10-25'],
  ['tomorrow', '2026-10-27'],
] as const) {
  test(`hides a history for ${name}, however fresh`, async ({ page }) => {
    let asked = false;
    await visit(page, noon, (route) => {
      asked = true;
      return route.fulfill(envelope('ok', { describedDate }));
    });
    await expect.poll(() => asked).toBe(true);
    await page.waitForTimeout(300);
    await expect(block(page)).toBeHidden();
  });
}

// Catches a failed, stale or broken answer shown, and a page that never recovers.
for (const [name, answer] of [
  [
    'the API fails',
    (route: Route) => route.fulfill({ status: 500, body: '{"error":"internal_error"}' }),
  ],
  ['the network fails', (route: Route) => route.abort()],
  ['the answer is stale', (route: Route) => route.fulfill(envelope('ok', { stale: true }))],
  ['the answer is not JSON', (route: Route) => route.fulfill({ status: 200, body: '<html>' })],
  [
    'a year is a string',
    (route: Route) => route.fulfill(envelope('ok', { data: { firstYear: '2023' } })),
  ],
] as const) {
  test(`shows nothing when ${name}, then recovers on a good answer`, async ({ page }) => {
    let requests = 0;
    await visit(page, noon, (route) =>
      ++requests === 1 ? answer(route) : route.fulfill(envelope('ok'))
    );
    await expect.poll(() => requests).toBe(1);
    await page.waitForTimeout(300);
    await expect(block(page)).toBeHidden();
    // With nothing to show it asks again after 5 minutes. Jump rather than run: running
    // would also play out the request's 5 s deadline.
    await page.clock.fastForward(5 * minute);
    await expect.poll(() => requests).toBe(2);
    await expect(lines(page)).toHaveCount(3);
  });
}

// Catches yesterday's history left on screen past midnight in Rabat until a tick or a new
// answer, and a new date's history never fetched.
test("hides the history at midnight in Rabat, then shows the new date's", async ({ page }) => {
  let requests = 0;
  await visit(page, '2026-10-26T23:59:30Z', (route) => {
    requests++;
    return route.fulfill(
      envelope('ok', { describedDate: requests === 1 ? '2026-10-26' : '2026-10-27' })
    );
  });
  await expect(lines(page)).toHaveCount(3);
  await page.clock.runFor(31_000);
  await expect(block(page)).toBeHidden();
  expect(requests).toBe(1);
  // With nothing for the new date it asks again 5 minutes after the last request. Jump
  // rather than run: running would also play out the request's 5 s deadline.
  await page.clock.fastForward(5 * minute);
  await expect.poll(() => requests).toBe(2);
  await expect(block(page).locator('time')).toHaveAttribute('datetime', '2026-10-27');
});

// Catches a tab that slept through midnight, or came back from the back/forward cache,
// showing yesterday's history until its next timer.
for (const event of ['visibilitychange', 'pageshow', 'focus'] as const) {
  test(`a page that wakes past midnight hides the history on ${event}`, async ({ page }) => {
    await visit(page, '2026-10-26T23:00:00Z', (route) => route.fulfill(envelope('ok')));
    await expect(lines(page)).toHaveCount(3);
    // The clock jumps without running the page's timers, as for a suspended tab.
    await page.clock.setSystemTime('2026-10-27T00:10:00Z');
    await expect(lines(page)).toHaveCount(3);
    await page.evaluate(
      (name) => (name === 'visibilitychange' ? document : window).dispatchEvent(new Event(name)),
      event
    );
    await expect(block(page)).toBeHidden({ timeout: 1_000 });
  });
}

// The page asks once on load, again hourly while it shows today's history, and one request at
// a time. Catches a request per minute tick, and requests that pile up behind a hanging one.
test('asks on load, then hourly, one request at a time', async ({ page }) => {
  let requests = 0;
  await visit(page, noon, async (route) => {
    requests++;
    // The second request hangs.
    if (requests !== 2) await route.fulfill(envelope('ok'));
  });
  await expect(lines(page)).toHaveCount(3);
  await page.clock.runFor(59 * minute);
  expect(requests).toBe(1);
  await page.clock.runFor(minute);
  await expect.poll(() => requests).toBe(2);
  // Events while it hangs ask nothing more.
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForTimeout(300);
  expect(requests).toBe(2);
  // The page clock flows at real speed between steps, so the 5 s deadline takes 5 s. A
  // refresh that fails drops the history, as the room's weather does (ADR 0029).
  await expect(block(page)).toBeHidden({ timeout: 8_000 });
  await page.clock.fastForward(5 * minute);
  await expect.poll(() => requests).toBe(3);
  await expect(block(page)).toBeVisible();
});

// Catches the date taken from the visitor's own time zone: in Auckland it is already the 27th
// at 12:00 UTC, in Los Angeles still the 25th at 03:00 UTC; Rabat's date is the 26th in both.
for (const [timezoneId, time] of [
  ['Pacific/Auckland', '2026-10-26T12:00:00Z'],
  ['America/Los_Angeles', '2026-10-26T03:00:00Z'],
] as const) {
  test(`a visitor in ${timezoneId} sees Rabat's date`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ timezoneId, ...(baseURL && { baseURL }) });
    const page = await context.newPage();
    await visit(page, time, (route) => route.fulfill(envelope('ok')));
    await expect(block(page).locator('time')).toHaveAttribute('datetime', '2026-10-26');
    await expect(lines(page)).toHaveCount(3);
    await context.close();
  });
}

// Catches a fixtures-mode build (local, CI, Previews) asking the production API, or showing
// sample history as if it were today's.
test('in fixtures mode the page asks for no history and shows none', async ({ page }) => {
  const asked: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/v1/listening-history')) asked.push(request.url());
  });
  await page.clock.install({ time: noon });
  await page.goto('/stats');
  await page.clock.runFor(10 * minute);
  await expect(block(page)).toBeHidden();
  expect(asked).toEqual([]);
});

// Catches the block, empty or with words from the build, showing without the script.
test('without JavaScript the history is hidden', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(`${baseURL}/stats`);
  await expect(page.locator('.history')).toBeHidden();
  await context.close();
});

// Catches the /stats script loaded on another page.
test('only /stats loads the history script', async ({ page }) => {
  const scripts: string[] = [];
  page.on('request', (request) => {
    if (request.resourceType() === 'script') scripts.push(request.url());
  });
  await page.goto('/');
  await page.goto('/about');
  expect(scripts.filter((url) => url.includes('/stats.astro_astro_type_script'))).toEqual([]);
});
