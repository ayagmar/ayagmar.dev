import type { Route } from '@playwright/test';
import { browseLink } from '../src/lib/writing.ts';
import { posts } from './content.ts';
import { expect, test } from './fixtures.ts';

test('Ctrl+K opens search and finds a post', { tag: '@drafts' }, async ({ page }) => {
  await page.goto('/about');
  await expect(page.getByRole('button', { name: /search/i })).toBeVisible();

  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Search' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Search the site').fill('token logs');

  const result = dialog.getByRole('link', { name: /what 17 coding agents taught me/ });
  await expect(result).toHaveAttribute('href', '/writing/token-logs');
  await result.click();
  await expect(page).toHaveURL(/\/writing\/token-logs$/);
});

test('/ opens search; drafts are not in the index', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: /search/i })).toBeVisible();

  await page.keyboard.press('/');
  const dialog = page.getByRole('dialog', { name: 'Search' });
  await dialog.getByLabel('Search the site').fill('ricing');
  await expect(dialog.getByRole('status')).toHaveText(
    'Nothing for "ricing". Try Projects, About or Stats.'
  );
});

// Catches a search that finds nothing leaving the reader with no way on, and a query painted as
// markup instead of text.
test('a search that finds nothing offers three pages and shows the query as typed', async ({
  page,
}) => {
  await page.goto('/about');
  await expect(page.getByRole('button', { name: /search/i })).toBeVisible();
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Search' });
  const query = '<qzxv>&amp;';
  await dialog.getByLabel('Search the site').fill(query);
  const status = dialog.getByRole('status');
  await expect(status).toHaveText(`Nothing for "${query}". Try Projects, About or Stats.`);
  await expect(status.locator('qzxv')).toHaveCount(0);
  await expect(status.getByRole('link')).toHaveText(['Projects', 'About', 'Stats']);
  await expect(status.getByRole('link', { name: 'About' })).toHaveAttribute('href', '/about');
});

// Catches the native search field taking the first Escape to clear itself, so closing took two,
// and focus lost on close.
test('one Escape closes search with text in the field, and focus goes back', async ({ page }) => {
  await page.goto('/about');
  const button = page.getByRole('button', { name: /search/i });
  await button.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Search' });
  await dialog.getByLabel('Search the site').fill('runnerd');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(button).toBeFocused();
});

// Catches /about's ways to reach me falling out of the index: a recruiter searches for them.
for (const term of ['contact', 'email', 'linkedin', 'github']) {
  test(`"${term}" finds /about`, async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: /search/i })).toBeVisible();
    await page.keyboard.press('Control+k');
    const dialog = page.getByRole('dialog', { name: 'Search' });
    await dialog.getByLabel('Search the site').fill(term);
    await expect(dialog.getByRole('link', { name: 'About', exact: true })).toHaveAttribute(
      'href',
      '/about'
    );
  });
}

// Catches the 404 naming a Search that does nothing.
test('the 404 opens search from its sentence', async ({ page }) => {
  await page.goto('/no-such-page');
  await expect(page.getByRole('button', { name: /search/i }).first()).toBeVisible();
  await page.locator('main').getByRole('button', { name: 'Search' }).click();
  await expect(page.getByRole('dialog', { name: 'Search' })).toBeVisible();
  await expect(page.locator('main .onward')).toHaveText(
    /^Try Search, or one of these: .+ or the home page\.$/,
    { useInnerText: true }
  );
});

// Catches the project pages falling out of the index: with no published post, search on
// production finds little else.
test('finds a project by its name', async ({ page }) => {
  await page.goto('/about');
  await expect(page.getByRole('button', { name: /search/i })).toBeVisible();
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Search' });
  await dialog.getByLabel('Search the site').fill('runnerd');
  const result = dialog.getByRole('link', { name: 'runnerd', exact: true });
  await expect(result).toHaveAttribute('href', '/projects/runnerd');
});

// Catches the Noctalia plugins falling out of the index: they have no pages of their own, so the
// section on /projects is the only place search can find them.
test('finds a Noctalia plugin on /projects', async ({ page }) => {
  await page.goto('/about');
  await expect(page.getByRole('button', { name: /search/i })).toBeVisible();
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Search' });
  await dialog.getByLabel('Search the site').fill('OBS');
  const result = dialog.getByRole('link', { name: 'Noctalia plugins', exact: true });
  await expect(result).toHaveAttribute('href', '/projects');
});

// Catches words in neighbouring inline elements running together in an excerpt, as
// "repo-pulseA self-hosted" and "CPUAMD Ryzen" did.
for (const { term, title, words } of [
  { term: 'self-hosted Cloudflare Worker', title: 'Now', words: 'repo-pulse A self-hosted' },
  { term: 'Ryzen', title: 'Uses', words: 'CPU AMD Ryzen' },
]) {
  test(`the ${title} excerpt for "${term}" keeps its words apart`, async ({ page }) => {
    await page.goto('/about');
    await expect(page.getByRole('button', { name: /search/i })).toBeVisible();
    await page.keyboard.press('Control+k');
    const dialog = page.getByRole('dialog', { name: 'Search' });
    await dialog.getByLabel('Search the site').fill(term);
    const result = dialog
      .getByRole('listitem')
      .filter({ has: page.getByRole('link', { name: title, exact: true }) });
    await expect(result).toContainText(words);
  });
}

// Catches an older search painting its answer, or its failure, over a newer input: clearing
// the field while "runner" is still loading must leave the dialog empty.
for (const outcome of ['answers', 'fails'] as const) {
  test(`a search that ${outcome} after the field is cleared shows nothing`, async ({ page }) => {
    const held: Route[] = [];
    await page.route('**/pagefind/fragment/**', (route) => {
      held.push(route);
    });
    await page.goto('/about');
    await expect(page.getByRole('button', { name: /search/i })).toBeVisible();
    await page.keyboard.press('Control+k');
    const dialog = page.getByRole('dialog', { name: 'Search' });
    const field = dialog.getByLabel('Search the site');
    await field.fill('runner');
    await expect.poll(() => held.length).toBeGreaterThan(0);
    await field.fill('');
    for (const route of held) {
      if (outcome === 'fails') await route.abort();
      else await route.continue();
    }
    await Promise.all(held.map((route) => route.request().response()));
    // The fragments are decoded and painted within a few tasks of arriving.
    await page.waitForTimeout(500);
    await expect(dialog.getByRole('status')).toHaveText('');
    await expect(dialog.getByRole('listitem')).toHaveCount(0);
  });
}

// Catches `/` taken from someone typing in a field, or from a browser shortcut that adds a
// modifier to it.
test('/ is left alone while typing and with a modifier', async ({ page }) => {
  await page.goto('/about');
  await expect(page.getByRole('button', { name: /search/i })).toBeVisible();
  const dialog = page.getByRole('dialog', { name: 'Search' });
  for (const key of ['Alt+/', 'Control+/', 'Meta+/']) await page.keyboard.press(key);
  await page.evaluate(() =>
    document.querySelector('main')?.prepend(document.createElement('input'))
  );
  await page.locator('main input').first().focus();
  await page.keyboard.press('/');
  await expect(page.locator('main input').first()).toHaveValue('/');
  await expect(dialog).toBeHidden();
});

// Catches `/` and `?` lost on layouts that type them with AltGr, which Windows reports as
// Ctrl+Alt (Brazilian ABNT2: AltGr+Q is `/`).
test('/ and ? typed with AltGr still work', async ({ page }) => {
  await page.goto('/about');
  await expect(page.getByRole('button', { name: /search/i })).toBeVisible();
  const altGr = (key: string) =>
    page.evaluate((key) => {
      const init = { key, ctrlKey: true, altKey: true, modifierAltGraph: true, bubbles: true };
      document.body.dispatchEvent(new KeyboardEvent('keydown', init));
    }, key);
  await altGr('?');
  const keys = page.getByRole('dialog', { name: 'Keyboard' });
  await expect(keys).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(keys).toBeHidden();
  await altGr('/');
  await expect(page.getByRole('dialog', { name: 'Search' })).toBeVisible();
});

// Catches the hint naming `/` while single-key shortcuts are off and `/` does nothing.
test('the hint names the key that opens search', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/about');
  const button = page.getByRole('button', { name: /search/i });
  await expect(button).toHaveAccessibleName('Search /');
  await page.evaluate(() => {
    document.documentElement.dataset.shortcuts = 'off';
  });
  await expect(button).toHaveAccessibleName('Search Ctrl K');
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  const builds = [
    { build: 'production', count: posts.filter((post) => !post.draft).length, tag: [] },
    { build: 'drafts', count: posts.length, tag: ['@drafts'] },
  ];
  for (const { build, count, tag } of builds) {
    // Catches the header's one link going to an empty /writing before the first post, or
    // staying on /projects after it.
    test(`offers a link to a page with content instead of the search button on ${build}`, {
      tag,
    }, async ({ page }) => {
      await page.goto('/');
      const { href, label } = browseLink(count);
      await expect(page.getByRole('link', { name: label })).toHaveAttribute('href', href);
    });
  }
});

test('the open search dialog keeps 24px targets and fits a 320px screen', {
  tag: '@drafts',
}, async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: /search/i })).toBeVisible();
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Search' });
  await dialog.getByLabel('Search the site').fill('token logs');
  await expect(dialog.getByRole('link').first()).toBeVisible();

  const targets = dialog.locator('input, button, a');
  expect(await targets.count()).toBeGreaterThanOrEqual(3);
  for (const target of await targets.all()) {
    const box = await target.boundingBox();
    const name = await target.evaluate((element) => element.outerHTML.slice(0, 60));
    expect(box?.width, name).toBeGreaterThanOrEqual(24);
    expect(box?.height, name).toBeGreaterThanOrEqual(24);
  }
  const overflow = await page.evaluate(() => {
    const open = document.querySelector('dialog[open]');
    return Math.max(
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
      open === null ? 0 : open.scrollWidth - open.clientWidth
    );
  });
  expect(overflow).toBeLessThanOrEqual(0);
});
