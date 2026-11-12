// Posts on the production build: no draft reaches a page, a feed, search, index.txt or the
// sitemap. While every post in content/writing is a placeholder draft, tests that need a post
// carry the @drafts tag and run on the build that shows drafts (playwright.config.ts).

import { nothingYet } from '../src/lib/writing.ts';
import { notes, posts } from './content.ts';
import { expectValidFeed } from './feed-rules.ts';
import { expect, feeds, notFoundPath, pages, test } from './fixtures.ts';

const published = posts.filter((post) => !post.draft);
const drafts = posts.filter((post) => post.draft);
const publishedNotes = notes.filter((note) => !note.draft);

test.describe('without published posts', () => {
  test.skip(published.length > 0, 'a post is published');

  // Catches an empty band on home or in its text copy, a blank /writing or a tag list with no
  // tags, and home's Writing section missing while there are notes to show in it.
  test('home drops Writing until it has content, /writing says so', async ({ page, request }) => {
    await page.goto('/');
    const panel = page.getByRole('region', { name: 'Writing' });
    if (publishedNotes.length === 0) {
      await expect(panel).toHaveCount(0);
      await expect(page.getByText(nothingYet.writing)).toHaveCount(0);
    } else {
      await expect(
        panel.getByText('No posts yet. The latest short notes, from TIL:')
      ).toBeVisible();
      await expect(panel.getByRole('link', { name: 'All notes' })).toHaveAttribute('href', '/til');
      const shown = await panel
        .locator('.home-notes a')
        .evaluateAll((links) => links.map((link) => link.getAttribute('href')));
      expect(shown.length).toBeGreaterThan(0);
      for (const href of shown) expect(href).toMatch(/^\/til\/[a-z0-9-]+$/);
    }

    await page.goto('/writing');
    await expect(page.getByRole('heading', { level: 1, name: 'Writing' })).toBeVisible();
    await expect(page.getByText(nothingYet.writing)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Tags' })).toHaveCount(0);

    const text = await (await request.get('/index.txt')).text();
    if (publishedNotes.length === 0) expect(text).not.toContain(nothingYet.writing);
    expect(text).not.toMatch(/^Writing$/m);
  });

  // Catches the first two items of the header being dead ends: the empty page offers its feeds
  // and the pages that have something to read, and never the other empty section.
  test('/writing and /til lead to the pages with content', async ({ page }) => {
    for (const path of ['/writing', ...(publishedNotes.length === 0 ? ['/til'] : [])]) {
      await page.goto(path);
      const column = page.locator('.column');
      const links = await column
        .locator('.onward a')
        .evaluateAll((anchors) => anchors.map((anchor) => anchor.getAttribute('href')));
      expect(links, path).toEqual([
        ...(path === '/writing' && publishedNotes.length > 0 ? ['/til'] : []),
        '/projects',
        '/about',
        '/now',
      ]);
      await expect(column.getByRole('link', { name: 'RSS' }), path).toHaveAttribute(
        'href',
        path === '/til' ? '/til/feed.xml' : '/feed.xml'
      );
    }
  });

  // Catches the 404 sending a reader to the empty writing index.
  test('the 404 points only at pages with content', async ({ page }) => {
    await page.goto(notFoundPath);
    const links = await page
      .locator('.column .onward a')
      .evaluateAll((anchors) => anchors.map((anchor) => anchor.getAttribute('href')));
    expect(links).toEqual([
      ...(publishedNotes.length > 0 ? ['/til'] : []),
      '/projects',
      '/about',
      '/now',
      '/',
    ]);
    await expect(page.locator('.column .onward')).toHaveText(/^Try Search, or one of these: /, {
      useInnerText: true,
    });
  });

  test.describe('without JavaScript', () => {
    test.use({ javaScriptEnabled: false });

    // Catches the 404 sending a reader to a Search the header only has with scripts on.
    test('the 404 does not offer Search', async ({ page }) => {
      await page.goto(notFoundPath);
      await expect(page.locator('.column .onward')).toHaveText(/^Try one of these: /, {
        useInnerText: true,
      });
    });
  });

  test('the writing feeds follow the validator rules with no entries', async ({
    page,
    request,
  }) => {
    for (const path of ['/feed.xml', '/atom.xml']) {
      expect(await expectValidFeed(page, request, path, '/writing'), path).toEqual([]);
    }
  });
});

// Catches a post that ships while it is still a draft, through any place a post is listed:
// its page, every page in the sitemap (home, /writing, tags, projects), every feed, index.txt,
// the sitemap itself and search.
test('draft posts are in none of the places a post is listed', async ({ page, request }) => {
  for (const { slug } of drafts) {
    expect((await request.get(`/writing/${slug}`)).status(), slug).toBe(404);
  }
  for (const path of [...pages, ...feeds, '/index.txt', '/sitemap-0.xml']) {
    const body = await (await request.get(path)).text();
    for (const { slug } of drafts) expect(body, path).not.toContain(`/writing/${slug}`);
  }

  await page.goto('/about');
  await expect(page.getByRole('button', { name: /search/i })).toBeVisible();
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Search' });
  for (const { slug, title } of drafts) {
    await dialog.getByLabel('Search the site').fill(title);
    // Pagefind ranks pages that match part of a query, so other pages may answer; the post must not.
    await expect(dialog.getByRole('status')).toHaveText(/results?\.$/);
    const found = await dialog
      .getByRole('link')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href')));
    expect(found.join(), slug).not.toContain(`/writing/${slug}`);
  }
});

// Catches the empty state outliving the first post: /writing lists it, and the 404 and an empty
// /til point at /writing again, with no edit to either.
test('the first post ends the empty state everywhere', { tag: '@drafts' }, async ({ page }) => {
  await page.goto('/writing');
  await expect(page.locator('.column .posts li')).toHaveCount(posts.length);
  await expect(page.getByText(nothingYet.writing)).toHaveCount(0);
  await expect(page.locator('.column .onward')).toHaveCount(0);

  await page.goto(notFoundPath);
  await expect(page.locator('.column .onward a[href="/writing"]')).toHaveCount(1);

  if (notes.length === 0) {
    await page.goto('/til');
    await expect(page.locator('.column .onward a[href="/writing"]')).toHaveCount(1);
  }
});

// Catches a feed that is well-formed only while empty: entries, dates, ids and links follow the
// validator's rules on every kind of writing feed, newest first.
test('feeds with entries follow the validator rules', { tag: '@drafts' }, async ({
  page,
  request,
}) => {
  const newestFirst = posts.toSorted(
    (a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug)
  );
  const links = await expectValidFeed(page, request, '/feed.xml', '/writing');
  expect(links).toEqual(newestFirst.map((post) => `https://ayagmar.dev/writing/${post.slug}`));
  const ids = await expectValidFeed(page, request, '/atom.xml', '/writing');
  expect(ids).toEqual(
    newestFirst.map((post) => `tag:ayagmar.dev,${post.date}:/writing/${post.slug}`)
  );
  for (const scope of ['/writing/tags/rust', '/projects/llm-usage-metrics']) {
    for (const feed of ['feed.xml', 'atom.xml']) {
      expect(await expectValidFeed(page, request, `${scope}/${feed}`, scope)).not.toEqual([]);
    }
  }
});
