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
