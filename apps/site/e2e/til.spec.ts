// The production build: no draft note reaches /til, a feed, search, index.txt or the sitemap.
// Notes on a build that shows drafts are in til-preview.spec.ts.

import { notes } from './content.ts';
import { expectValidFeed } from './feed-rules.ts';
import { expect, test } from './fixtures.ts';

const published = notes.filter((note) => !note.draft);
const drafts = notes.filter((note) => note.draft);

test.describe('without published notes', () => {
  test.skip(published.length > 0, 'a note is published');

  // Catches an empty /til that renders a blank sheet or an error instead of saying so.
  test('/til says nothing is published and offers its feeds', async ({ page }) => {
    await page.goto('/til');
    await expect(page.getByRole('heading', { level: 1, name: 'Today I learned' })).toBeVisible();
    await expect(page.getByText('Nothing published yet.')).toBeVisible();
    await expect(page.locator('.til-note')).toHaveCount(0);
    await expect(page.locator('.reader').getByRole('link', { name: 'RSS' })).toHaveAttribute(
      'href',
      '/til/feed.xml'
    );
  });

  test('index.txt says the TIL section is empty', async ({ request }) => {
    const text = await (await request.get('/index.txt')).text();
    expect(text).toMatch(/\nTIL\n {2}Nothing published yet\.\n/);
  });
});

// Catches a note that ships while it is still a draft, through any of the places a note can
// be listed: the page, its permalink, both feeds, the writing feeds, search, index.txt and the
// sitemap.
test('draft notes are in none of the places a note is listed', async ({ page, request }) => {
  for (const { slug } of drafts) {
    expect((await request.get(`/til/${slug}`)).status(), slug).toBe(404);
  }
  const bodies = [
    await (await request.get('/til')).text(),
    await (await request.get('/til/feed.xml')).text(),
    await (await request.get('/til/atom.xml')).text(),
    await (await request.get('/feed.xml')).text(),
    await (await request.get('/atom.xml')).text(),
    await (await request.get('/index.txt')).text(),
    await (await request.get('/sitemap-0.xml')).text(),
  ];
  for (const { slug } of drafts) for (const body of bodies) expect(body).not.toContain(slug);

  await page.goto('/about');
  await expect(page.getByRole('button', { name: /search/i })).toBeVisible();
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Search' });
  for (const { slug, title } of drafts) {
    await dialog.getByLabel('Search posts').fill(title);
    // Pagefind ranks pages that match part of a query, so other pages may answer; the note must not.
    await expect(dialog.getByRole('status')).toHaveText(/results?\.$/);
    const found = await dialog
      .getByRole('link')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href')));
    expect(found.join(), slug).not.toContain(slug);
  }
});

test.describe('feeds', () => {
  for (const path of ['/til/feed.xml', '/til/atom.xml']) {
    test(`${path} follows the validator's rules`, async ({ page, request }) => {
      const keys = await expectValidFeed(page, request, path, '/til');
      expect(keys).toHaveLength(published.length);
    });
  }
});

// Catches the TIL feeds leaking onto every page, or missing from the pages they belong to.
test('only TIL pages link the TIL feeds', async ({ page }) => {
  const discovered = async (path: string) => {
    await page.goto(path);
    return page
      .locator('link[rel="alternate"]')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href')));
  };
  expect(await discovered('/til')).toEqual([
    '/feed.xml',
    '/atom.xml',
    '/til/feed.xml',
    '/til/atom.xml',
  ]);
  expect(await discovered('/writing')).toEqual(['/feed.xml', '/atom.xml']);
});
