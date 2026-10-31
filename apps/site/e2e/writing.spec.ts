// Posts on the production build: no draft reaches a page, a feed, search, index.txt or the
// sitemap. While every post in content/writing is a placeholder draft, tests that need a post
// carry the @drafts tag and run on the build that shows drafts (playwright.config.ts).
import { posts } from './content.ts';
import { expectValidFeed } from './feed-rules.ts';
import { expect, feeds, pages, test } from './fixtures.ts';

const published = posts.filter((post) => !post.draft);
const drafts = posts.filter((post) => post.draft);

test.describe('without published posts', () => {
  test.skip(published.length > 0, 'a post is published');

  // Catches an empty list that renders a blank panel, an error or a tag list with no tags, and
  // home's Writing window left empty while there are notes to show in it.
  test('home, /writing and index.txt say nothing is published', async ({ page, request }) => {
    await page.goto('/');
    const panel = page.getByRole('region', { name: 'Writing' });
    await expect(panel.getByText('No posts yet. The latest short notes, from TIL:')).toBeVisible();
    await expect(panel.getByRole('link', { name: 'All notes' })).toHaveAttribute('href', '/til');
    const notes = await panel
      .locator('.home-notes a')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href')));
    expect(notes.length).toBeGreaterThan(0);
    for (const href of notes) expect(href).toMatch(/^\/til\/[a-z0-9-]+$/);

    await page.goto('/writing');
    await expect(page.getByRole('heading', { level: 1, name: 'Writing' })).toBeVisible();
    await expect(page.getByText('Nothing published yet.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Tags' })).toHaveCount(0);

    const text = await (await request.get('/index.txt')).text();
    expect(text).toMatch(/\nWriting\n {2}Nothing published yet\.\n/);
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
    await dialog.getByLabel('Search posts').fill(title);
    // Pagefind ranks pages that match part of a query, so other pages may answer; the post must not.
    await expect(dialog.getByRole('status')).toHaveText(/results?\.$/);
    const found = await dialog
      .getByRole('link')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href')));
    expect(found.join(), slug).not.toContain(`/writing/${slug}`);
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
