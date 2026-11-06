// Year pages (src/lib/years.ts), from the fixtures: the calendar leads to real day pages, and the
// page is reachable from /stats and from a day.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { dailySources } from '@min7/contracts';
import { daysFixtures, historyFixtures } from '@min7/contracts/fixtures';
import { expect, notFoundPath, test } from './fixtures.ts';

const dist = join(import.meta.dirname, '..', 'dist');

// Catches a square that links to a page the build did not make, a recorded date with no link, and the two series' sections losing the calendar each counts in.
test('the year shows its calendar, each square leading to an existing day', async ({ page }) => {
  await page.goto('/2026');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('2026');
  const shipped = page.getByRole('region', { name: 'Shipped' });
  await expect(shipped.getByText('Counted over the UTC day.')).toBeVisible();
  const agents = page.getByRole('region', { name: 'Agent usage' });
  await expect(
    agents.getByText('Counted over the day in Rabat (Africa/Casablanca).')
  ).toBeVisible();

  const hrefs = await shipped
    .locator('.year-heat a')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
  expect(hrefs.filter((href) => !existsSync(join(dist, `${href.slice(1)}.html`)))).toEqual([]);
  const recorded = dailySources
    .flatMap((series) => [...historyFixtures[series].ok.days, ...daysFixtures[series].ok.days])
    .map((day) => day.date)
    .filter((date) => date.startsWith('2026-'));
  expect(recorded.filter((date) => !hrefs.includes(`/day/${date}`))).toEqual([]);
  await shipped.getByRole('link', { name: '25 Oct: 16 pushes, merges and releases' }).click();
  await expect(page).toHaveURL('/day/2026-10-25');
  await page.getByRole('link', { name: 'All of 2026' }).click();
  await expect(page).toHaveURL('/2026');
});

// Catches the year's link pointing at a year without a page, and neighbours linked the wrong way.
test('/stats leads to the latest year, which links the one before', async ({ page }) => {
  await page.goto('/stats');
  await page.getByRole('link', { name: 'All of 2026' }).click();
  await expect(page).toHaveURL('/2026');
  await page.getByRole('navigation', { name: 'Other years' }).getByRole('link').click();
  await expect(page).toHaveURL('/2025');
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
});

// Catches the top-level `[year]` route answering for a year with no history or for any other
// path, instead of the 404 page.
test('a year with no history and other top-level paths are the 404 page', async ({ page }) => {
  for (const path of ['/2024', '/2031', '/20261', notFoundPath]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(404);
  }
});

// Catches the strip's outline winning over the calendar's faint square: both rules are as
// specific, so which one holds depends on the order the stylesheets are bundled in.
test('a day with no record in a shown month is faint, not outlined', async ({ page }) => {
  await page.goto('/2026');
  const style = await page
    .locator('.year-heat i[data-l="none"]')
    .first()
    .evaluate((square) => getComputedStyle(square).outlineStyle);
  expect(style).toBe('none');
  await expect(page.locator('.year-heat .heat-cap')).toContainText('faint days have no record');
});
