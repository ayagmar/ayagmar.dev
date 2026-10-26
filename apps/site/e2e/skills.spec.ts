import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures.ts';

const { skills } = JSON.parse(
  readFileSync(join(import.meta.dirname, '../../../content/skills.json'), 'utf8')
) as { skills: { name: string; version: string; readme: string; npm: string }[] };

test('the shelf shows every skill in content/skills.json with its links', async ({ page }) => {
  await page.goto('/skills');
  await expect(page.getByRole('heading', { level: 3 })).toHaveCount(skills.length);
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

// The mark is a ratio; the sentence with the run's detail is one click away, with the install line.
test('an evaluated skill shows a compact mark and opens its run and install line', async ({
  page,
}) => {
  await page.goto('/skills');
  const entry = page.locator('#engineering-optimization');
  await expect(entry.locator('.mark')).toContainText('2/3');
  await expect(entry.getByText(/2 of 3 cases passed, pass mark 80%/)).toBeHidden();
  await entry.locator('summary').click();
  await expect(entry.getByText(/2 of 3 cases passed, pass mark 80%/)).toBeVisible();
  await expect(entry.locator('.install')).toContainText('--skill engineering-optimization');
});

test('skills are grouped under headings and one install pattern is shown once', async ({
  page,
}) => {
  await page.goto('/skills');
  await expect(page.getByRole('heading', { level: 2 })).toHaveText([
    'Plan',
    'Review',
    'Delegate and ship',
    'Write',
    'Read and recall',
  ]);
  await expect(page.locator('header .install')).toHaveText(
    'npx skills add ayagmar/agents-skills --skill <name> --agent <agent>'
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
        .locator('main a:visible, main summary:visible')
        .evaluateAll((links) =>
          links.filter((link) => link.getBoundingClientRect().height < 24).map((l) => l.textContent)
        );
      // Links in running text are exempt from the target size rule; the shelf's own are not.
      expect(small.filter((text) => /README|npm|Install/.test(text ?? ''))).toEqual([]);
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

// Catches the sixth nav entry wrapping the header, overflowing at the width where the nav row
// first appears, or missing from the phone Menu.
test('Skills is in the header row from 52rem and in the phone Menu, and the header still fits', async ({
  page,
}) => {
  for (const width of [832, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/skills');
    const nav = page.getByRole('navigation', { name: 'Site' });
    await expect(nav.getByRole('link', { name: 'Skills' })).toHaveAttribute('aria-current', 'page');
    const links = await nav
      .getByRole('link')
      .evaluateAll((items) => items.map((item) => item.textContent));
    expect(links).toEqual(['Writing', 'TIL', 'Projects', 'Skills', 'Stats', 'About']);
    expect((await page.locator('.site-header').boundingBox())?.height).toBeLessThan(64);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      )
    ).toBeLessThanOrEqual(0);
  }
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(
    page.getByRole('navigation', { name: 'Site' }).getByRole('link', { name: 'Skills' })
  ).toHaveAttribute('href', '/skills');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    )
  ).toBeLessThanOrEqual(0);
});
