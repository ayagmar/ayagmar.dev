// The parts of /stats and /uses the browser reads from signals (ADR 0014, ADR 0032): agent
// hours, the desktop facts and this month's agents. The e2e build runs in fixtures mode, where
// these pages never ask signals for anything. Each test below gives the blocks the API
// endpoints, as an `api` mode build would, answers the API itself from the shared fixtures,
// and fixes the browser's clock.
import AxeBuilder from '@axe-core/playwright';
import { snapshotFixtures } from '@min7/contracts/fixtures';
import type { Page, Route } from '@playwright/test';
import { expect, test } from './fixtures.ts';

const api = 'https://api.ayagmar.dev/v1';
const minute = 60_000;
// Noon on 2026-10-26 in Rabat (+00); the snapshots below were taken at 08:00.
const noon = '2026-10-26T12:00:00Z';
const taken = '2026-10-26T08:00:00.000Z';

type Answer = Parameters<Route['fulfill']>[0] | 'abort';

const json = (body: unknown): Answer => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify(body),
});
const llmUsage = (data: unknown = snapshotFixtures['llm-usage'].ok, fields: object = {}) =>
  json({ source: 'llm-usage', version: 1, fetchedAt: taken, stale: false, data, ...fields });
const desktop = (data: object = {}, fields: object = {}) =>
  json({
    source: 'desktop',
    version: 1,
    fetchedAt: taken,
    stale: false,
    data: { ...snapshotFixtures.desktop.ok, ...data },
    ...fields,
  });

/**
 * Opens `path` at `time` with its live blocks turned on and the API answered by `answers`.
 * Returns every request the page made to another origin.
 */
async function visit(
  page: Page,
  path: '/stats' | '/uses',
  time: string,
  answers: { 'llm-usage'?: Answer; desktop?: Answer }
) {
  const outside: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1')) outside.push(request.url());
  });
  await page.clock.install({ time });
  await page.route(`**${path}`, async (route) => {
    const response = await route.fetch();
    const html = (await response.text())
      .replace('class="agent-hours"', `class="agent-hours" data-llm-usage-src="${api}/llm-usage"`)
      .replace('class="agents-month"', `class="agents-month" data-llm-usage-src="${api}/llm-usage"`)
      .replace('class="desktop-facts"', `class="desktop-facts" data-desktop-src="${api}/desktop"`);
    await route.fulfill({ response, body: html });
  });
  for (const source of ['llm-usage', 'desktop'] as const) {
    await page.route(`${api}/${source}`, (route) => {
      const answer = answers[source] ?? { status: 503 };
      return answer === 'abort' ? route.abort() : route.fulfill(answer);
    });
  }
  // The history block on /stats has no endpoint here, so it asks nothing.
  await page.goto(path);
  return outside;
}

const hoursBlock = (page: Page) => page.locator('.agent-hours');
const live = (page: Page) => page.locator('.uses-live');
const facts = (page: Page) => page.locator('.desktop-facts');
const agents = (page: Page) => page.locator('.agents-month');

test.describe('agent hours on /stats', () => {
  // Catches the wrong period's number, hours shown with the wrong unit, or the explanation
  // missing.
  test('shows this month and the last 7 days, as of the snapshot', async ({ page }) => {
    await visit(page, '/stats', noon, { 'llm-usage': llmUsage() });
    await expect(hoursBlock(page)).toBeVisible();
    await expect(hoursBlock(page).getByRole('heading')).toHaveText('Estimated agent hours');
    await expect(hoursBlock(page).locator('.agent-hours-month dd')).toHaveText('144 hours');
    await expect(hoursBlock(page).locator('.agent-hours-week dd')).toHaveText('60 hours');
    await expect(hoursBlock(page)).toContainText('not my hours at the keyboard');
    await expect(hoursBlock(page).locator('.agent-hours-as-of')).toHaveText(
      'As of 26 Oct, 08:00 UTC.'
    );
    await expect(page.locator('.llm-usage-empty')).toBeHidden();
  });

  // Catches an old producer's push shown as 0 hours.
  test('stays hidden when the snapshot has no hours', async ({ page }) => {
    const outside = await visit(page, '/stats', noon, {
      'llm-usage': llmUsage(snapshotFixtures['llm-usage'].minimal),
    });
    await expect.poll(() => outside.length).toBe(1);
    await page.waitForTimeout(300);
    await expect(hoursBlock(page)).toBeHidden();
    await expect(page.locator('.llm-usage-empty')).toBeVisible();
  });

  // Catches "this month" left on screen past midnight in Rabat by an open tab.
  test('hides the hours at midnight in Rabat while the tab is open', async ({ page }) => {
    await visit(page, '/stats', '2026-10-26T23:58:00Z', { 'llm-usage': llmUsage() });
    await expect(hoursBlock(page)).toBeVisible();
    await page.clock.runFor(3 * minute);
    await expect(hoursBlock(page)).toBeHidden();
  });

  for (const [name, answer] of [
    ['a failed request', 'abort'],
    ['an error status', { status: 500, contentType: 'application/json', body: '{}' }],
    ['a stale snapshot', llmUsage(undefined, { stale: true })],
    ['broken JSON', { status: 200, contentType: 'application/json', body: '{"source":' }],
  ] as const) {
    test(`shows nothing for ${name}`, async ({ page }) => {
      await visit(page, '/stats', noon, { 'llm-usage': answer });
      await page.waitForTimeout(300);
      await expect(hoursBlock(page)).toBeHidden();
    });
  }
});

test.describe('/uses', () => {
  // Catches a value in the wrong row, or an uptime that is not from the reported boot.
  test('shows the desktop facts and this month’s agents', async ({ page }) => {
    const outside = await visit(page, '/uses', noon, {
      desktop: desktop(),
      'llm-usage': llmUsage(),
    });
    await expect(live(page)).toBeVisible();
    await expect(facts(page).locator('.desktop-kernel dd')).toHaveText('7.2.11-arch1-1');
    await expect(facts(page).locator('.desktop-niri dd')).toHaveText('26.04');
    // Booted 2026-10-23 07:41 UTC, three days and some hours before noon on the 26th.
    await expect(facts(page).locator('.desktop-uptime dd')).toHaveText(
      '3 days, from the last reported boot'
    );
    await expect(facts(page).locator('.desktop-reported')).toHaveText('Reported 4 hours ago.');
    await expect(agents(page).locator('li')).toHaveText(['Claude Code', 'Codex', 'pi']);
    expect(outside.sort()).toEqual([`${api}/desktop`, `${api}/llm-usage`]);
  });

  // Catches one source's failure taking the other down, or the static parts with it.
  test('shows each part on its own and the static parts always', async ({ page }) => {
    await visit(page, '/uses', noon, { desktop: 'abort', 'llm-usage': llmUsage() });
    await expect(agents(page)).toBeVisible();
    await expect(facts(page)).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Desktop', level: 2 })).toBeVisible();
    await expect(page.getByText('AMD Ryzen 9 9950X3D (16 cores)')).toBeVisible();
    await expect(page.getByText('Lenovo ThinkPad P1 Gen 7')).toBeVisible();
  });

  // Catches facts from a reboot ago kept after the producer went quiet, and a value the
  // allowlist rejects shown anyway.
  for (const [name, answer] of [
    ['reported more than 2 days ago', desktop({}, { fetchedAt: '2026-10-24T11:59:00.000Z' })],
    ['booted after the report', desktop({ bootedAt: '2026-10-26T09:00:00.000Z' })],
    ['dated ahead of the browser', desktop({}, { fetchedAt: '2026-10-26T12:10:00.000Z' })],
    ['with a kernel outside the allowlist', desktop({ kernel: '7.2.11-arch1-1-myhost' })],
  ] as const) {
    test(`hides desktop facts ${name}`, async ({ page }) => {
      await visit(page, '/uses', noon, { desktop: answer });
      await page.waitForTimeout(300);
      await expect(live(page)).toBeHidden();
      await expect(page.getByText('myhost')).toHaveCount(0);
    });
  }

  test('hides the facts once they expire in an open tab', async ({ page }) => {
    await visit(page, '/uses', '2026-10-28T07:58:00Z', { desktop: desktop() });
    await expect(facts(page)).toBeVisible();
    await page.clock.runFor(3 * minute);
    await expect(live(page)).toBeHidden();
  });

  // Catches names from signals treated as markup.
  test('shows agent names as text', async ({ page }) => {
    const ok = snapshotFixtures['llm-usage'].ok;
    const name = '<img src=x onerror="document.title=1">';
    const data = {
      ...ok,
      monthToDate: { ...ok.monthToDate, agents: [{ ...ok.monthToDate.agents[0], agent: name }] },
    };
    await visit(page, '/uses', noon, { 'llm-usage': llmUsage(data) });
    await expect(agents(page).locator('li')).toHaveText([name]);
    await expect(agents(page).locator('img')).toHaveCount(0);
  });
});

test('without JavaScript, /uses shows its static parts and no live panel', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/uses');
  await expect(page.getByText('NVIDIA GeForce RTX 5090')).toBeVisible();
  await expect(live(page)).toBeHidden();
  await context.close();
});

// Catches a request to signals from the fixtures build, which also builds public Previews.
test('in fixtures mode, /stats and /uses ask signals nothing', async ({ page }) => {
  const outside: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1')) outside.push(request.url());
  });
  for (const path of ['/stats', '/uses']) {
    await page.goto(path);
    await page.waitForTimeout(300);
  }
  expect(outside).toEqual([]);
  await expect(live(page)).toBeHidden();
});

// Catches the live parts overflowing a phone, failing axe in either theme, or shifting the
// page once they fill in.
for (const width of [320, 360, 1280]) {
  for (const path of ['/stats', '/uses'] as const) {
    test(`${path} with its live parts fits ${width}px and passes axe in both themes`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await visit(page, path, noon, { desktop: desktop(), 'llm-usage': llmUsage() });
      await expect(path === '/stats' ? hoursBlock(page) : live(page)).toBeVisible();
      if (path === '/uses') await expect(agents(page)).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth
        )
      ).toBeLessThanOrEqual(0);
      for (const colorScheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme });
        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
          .analyze();
        expect(results.violations.map((v) => `${v.id}: ${v.nodes.length} nodes`)).toEqual([]);
      }
    });
  }
}
