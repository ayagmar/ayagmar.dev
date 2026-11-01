// Day pages and receipts (src/lib/days.ts), from the fixtures: the strip's squares lead to a
// day's page and back, and a post with a `receipts` range shows its line.
import { expect, test } from './fixtures.ts';

// Catches a square that is not a link (or not reachable by keyboard), a link to a page the
// build did not make, and a day page that mixes up the two series' calendars.
test('a square of the shipping strip opens its day, and back returns to the strip', async ({
  page,
}) => {
  await page.goto('/');
  const strip = page.locator('section:has(#shipping) .heat');
  // Recording begins on 12 Oct in the fixtures: the 15 recorded days have pages, the 13
  // outlined days before them have none.
  await expect(strip.getByRole('link')).toHaveCount(15);
  const day = strip.getByRole('link', { name: '25 Oct: 16 pushes, merges and releases' });
  await day.focus();
  await page.keyboard.press('Enter');

  await expect(page).toHaveURL('/day/2026-10-25');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('25 October 2026');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
  const shipped = page.getByRole('region', { name: 'Shipped' });
  await expect(shipped.getByText('Counted over the UTC day.')).toBeVisible();
  await expect(shipped.locator('.day-total')).toHaveText('12 merges · 19 commits in 4 pushes');
  const agents = page.getByRole('region', { name: 'Agent usage' });
  await expect(
    agents.getByText('Counted over the day in Rabat (Africa/Casablanca).')
  ).toBeVisible();
  await expect(agents.locator('.day-total')).toHaveText(
    '1.3M tokens · 7.7 hours of agent time, estimated'
  );
  const others = page.getByRole('navigation', { name: 'Other days' });
  await expect(others.getByRole('link', { name: '← 24 October 2026' })).toHaveAttribute(
    'href',
    '/day/2026-10-24'
  );

  await page.goBack();
  await expect(page).toHaveURL('/');
  await expect(strip.getByRole('link')).toHaveCount(15);
});

// Catches the frontmatter range ignored, the post's project not used as the repository filter,
// and agent tokens or active days counted outside the range.
test('a post with receipts shows its line', { tag: '@drafts' }, async ({ page }) => {
  await page.goto('/writing/token-logs');
  await expect(page.locator('.post-header .receipt')).toHaveText(
    '12–20 Oct 2026, llm-usage-metrics: 1 PR merged · 12 commits · 9.1M agent tokens in all · 6 active days'
  );
  // A post without the field has no line.
  await page.goto('/writing/cache-reads');
  await expect(page.locator('.receipt')).toHaveCount(0);
});
