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
  await expect(page.locator('header .lede + p')).toHaveText(about.nameNote);
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
