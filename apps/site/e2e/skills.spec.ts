import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures.ts';

const { skills } = JSON.parse(
  readFileSync(join(import.meta.dirname, '../../../content/skills.json'), 'utf8')
) as { skills: { name: string; version: string; readme: string; npm: string }[] };

test('the shelf shows every skill in content/skills.json with its links', async ({ page }) => {
  await page.goto('/skills');
  await expect(page.getByRole('heading', { level: 2 })).toHaveText(skills.map((s) => s.name));
  for (const skill of skills) {
    const entry = page.locator(`#${skill.name}`);
    await expect(entry).toContainText(`v${skill.version}`);
    await expect(entry.getByRole('link', { name: /^README/ })).toHaveAttribute(
      'href',
      skill.readme
    );
    await expect(entry.getByRole('link', { name: /^npm/ })).toHaveAttribute('href', skill.npm);
  }
});

// The row of marks is decoration; the sentence beside it is the result.
test('an evaluated skill states its result in words', async ({ page }) => {
  await page.goto('/skills');
  await expect(page.locator('#engineering-optimization .evals')).toContainText(
    /2 of 3 cases passed, pass mark 80%/
  );
});

for (const colorScheme of ['light', 'dark'] as const) {
  for (const width of [360, 1280]) {
    test(`has no axe violations in ${colorScheme} at ${width}px, with targets of 24px`, async ({
      browser,
    }) => {
      const context = await browser.newContext({ colorScheme, viewport: { width, height: 800 } });
      const page = await context.newPage();
      await page.goto('/skills');
      await expect(page.getByRole('button', { name: /search/i })).toBeVisible();
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
        .analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.length} nodes`)).toEqual([]);
      const small = await page
        .locator('main a:visible')
        .evaluateAll((links) =>
          links.filter((link) => link.getBoundingClientRect().height < 24).map((l) => l.textContent)
        );
      // Links in running text are exempt from the target size rule; the shelf's own are not.
      expect(small.filter((text) => /README|npm/.test(text ?? ''))).toEqual([]);
      await context.close();
    });
  }
}

test('search finds the shelf, labelled Skills', async ({ page }) => {
  await page.goto('/about');
  await expect(page.getByRole('button', { name: /search/i })).toBeVisible();
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Search' });
  await dialog.getByLabel('Search posts').fill('falsify');
  await expect(dialog.getByRole('link', { name: 'Skills' })).toHaveAttribute('href', '/skills');
});

test('the plain-text page lists the shelf on one line', async ({ request }) => {
  const text = await (await request.get('/index.txt')).text();
  expect(text.split('\n').filter((line) => line.includes('/skills'))).toEqual([
    '  Skills     https://ayagmar.dev/skills',
  ]);
});
