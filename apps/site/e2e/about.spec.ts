import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from './fixtures.ts';

const about = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', '..', '..', 'content', 'about.json'), 'utf8')
);

// Catches the note on the name missing, shown twice, or moved out of the whoami panel.
test('/about shows the note on the name once, under the summary', async ({ page }) => {
  await page.goto('/about');
  const note = page.getByText(about.nameNote, { exact: true });
  await expect(note).toHaveCount(1);
  await expect(page.locator('header .lede-aside')).toHaveText(about.nameNote);
});

// Catches the languages section named Skills again, which the header's Skills (agent skills on
// /skills) already means.
test('/about lists the stack under its own name', async ({ page }) => {
  await page.goto('/about');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 2, name: 'Stack' })).toBeVisible();
  await expect(main.getByRole('heading', { name: 'Skills' })).toHaveCount(0);
});

// Catches a certification card dropped, or one losing its end date or its verify link.
test('/about shows a card per certification with its end and verify link', async ({ page }) => {
  await page.goto('/about');
  const cards = page.locator('section[aria-labelledby="certifications"] li');
  await expect(cards.getByRole('heading', { level: 3 })).toHaveText(
    about.certifications.map((cert: { name: string }) => cert.name)
  );
  const claude = cards.filter({ hasText: 'Claude Certified Developer' });
  await expect(claude).toContainText(/(?:Valid to|Expired) Sep 2027/);
  await expect(
    claude.getByRole('link', { name: 'Verify Claude Certified Developer - Foundations' })
  ).toHaveAttribute('href', about.certifications[1].verifyUrl);
});

// Catches a certification with a badge in content/about.json drawn without it, or with one the
// site does not serve.
test('/about shows each certification badge from the site', async ({ page, request }) => {
  await page.goto('/about');
  const cards = page.locator('section[aria-labelledby="certifications"] li');
  const sources = await cards.evaluateAll((items) =>
    items.map((item) => item.querySelector('img.cert-badge')?.getAttribute('src') ?? null)
  );
  expect(sources.map((src) => src !== null)).toEqual(
    about.certifications.map((cert: { badge?: unknown }) => cert.badge !== undefined)
  );
  for (const src of sources.filter((src) => src !== null)) {
    expect(src).toMatch(/^\/_astro\/[\w.-]+\.webp$/);
    expect((await request.get(src)).headers()['content-type'], src).toBe('image/webp');
  }
});
