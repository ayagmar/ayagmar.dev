// Tag pages (/tags/<tag>): one per tag a published post or note uses, posts first, then notes.
// Production has published notes and no published post; the drafts build has both.

import type { Page } from '@playwright/test';
import { notes, posts } from './content.ts';
import { expect, test } from './fixtures.ts';

type Entry = (typeof posts)[number];

const newestFirst = (entries: Entry[]) =>
  entries.toSorted((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));

/** What /tags/<tag> should list on a build that shows `posts` and `notes`. */
function expected(tag: string, shown: { posts: Entry[]; notes: Entry[] }) {
  return {
    posts: newestFirst(shown.posts.filter((post) => post.tags.includes(tag))).map(
      (post) => `/writing/${post.slug}`
    ),
    notes: newestFirst(shown.notes.filter((note) => note.tags.includes(tag))).map(
      (note) => `/til/${note.slug}`
    ),
  };
}

/** What a tag page lists: its section headings, and the links in each. */
async function listed(page: Page) {
  const column = page.locator('.column');
  return {
    headings: await column.locator('h2').allTextContents(),
    posts: await column
      .locator('.posts a')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href'))),
    notes: await column
      .locator('.til-note h3 a')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href'))),
  };
}

const live = { posts: posts.filter((p) => !p.draft), notes: notes.filter((n) => !n.draft) };
const liveTags = [...new Set([...live.posts, ...live.notes].flatMap((entry) => entry.tags))];
const draftOnlyTags = [
  ...new Set([...posts, ...notes].filter((e) => e.draft).flatMap((e) => e.tags)),
].filter((tag) => !liveTags.includes(tag));

// Catches a tag a published note uses getting no page, a page missing a post or note or
// listing one out of order, an empty section left in, and a tag only drafts use reaching
// production.
test('every published tag has a page listing its posts, then its notes', async ({
  page,
  request,
}) => {
  test.skip(liveTags.length === 0, 'nothing published has a tag');
  for (const tag of liveTags) {
    expect((await page.goto(`/tags/${tag}`))?.status(), tag).toBe(200);
    const want = expected(tag, live);
    expect(await listed(page), tag).toEqual({
      headings: [
        ...(want.posts.length > 0 ? ['Posts'] : []),
        ...(want.notes.length > 0 ? ['Notes'] : []),
      ],
      ...want,
    });
  }
  for (const tag of draftOnlyTags) {
    expect((await request.get(`/tags/${tag}`)).status(), tag).toBe(404);
  }
});

// Catches a tag with only notes offering writing feeds that do not exist for it (ADR 0028:
// notes are in no writing feed) instead of the TIL feeds.
test('a tag with notes and no posts offers the TIL feeds', async ({ page, request }) => {
  const tag = liveTags.find((t) => expected(t, live).posts.length === 0);
  test.skip(tag === undefined, 'no published tag has notes only');
  await page.goto(`/tags/${tag}`);
  const discovered = await page
    .locator('link[rel="alternate"]')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href')));
  expect(discovered).toEqual(['/feed.xml', '/atom.xml', '/til/feed.xml', '/til/atom.xml']);
  const caption = page.locator('.column > .caption');
  await expect(caption).toHaveText('Follow the notes: RSS, Atom.');
  for (const name of ['RSS', 'Atom']) {
    const href = await caption.getByRole('link', { name }).getAttribute('href');
    expect((await request.get(href ?? '')).status(), name).toBe(200);
  }
  expect((await request.get(`/writing/tags/${tag}/feed.xml`)).status()).toBe(404);
});

// Catches a note's tags staying plain text, or linking to a page that was never built.
test('tags on /til and on a note lead to their tag page', async ({ page, request }) => {
  const note = newestFirst(live.notes).find((n) => n.tags.length > 0);
  test.skip(note === undefined, 'no published note has a tag');
  const want = note?.tags.map((tag) => `/tags/${tag}`) ?? [];
  for (const [path, scope] of [
    ['/til', `.til-note:has(a[href="/til/${note?.slug}"]) .tags a`],
    [`/til/${note?.slug}`, '.post-header .tags a'],
  ] as const) {
    await page.goto(path);
    const hrefs = await page
      .locator(scope)
      .evaluateAll((links) => links.map((link) => link.getAttribute('href')));
    expect(hrefs, path).toEqual(want);
  }
  for (const href of want) expect((await request.get(href)).status(), href).toBe(200);
});

// Catches the tag page's old address going dead: the tag feeds still name it as their page
// (ADR 0021), so it must lead to the new one.
test("a tag page's old address leads to the new one", async ({ request }) => {
  const tag = liveTags[0] ?? 'linux';
  const response = await request.get(`/writing/tags/${tag}`, { maxRedirects: 0 });
  expect(response.status()).toBe(301);
  expect(new URL(response.headers().location ?? '', 'http://127.0.0.1').pathname).toBe(
    `/tags/${tag}`
  );
});

const all = { posts, notes };
const sharedTag = [...new Set(posts.flatMap((post) => post.tags))].find((tag) =>
  notes.some((note) => note.tags.includes(tag))
);

// Catches a tag both kinds use listing one kind only, notes before posts, or offering the TIL
// feeds when it has posts of its own.
test('a tag posts and notes share lists both and offers its own feeds', { tag: '@drafts' }, async ({
  page,
}) => {
  test.skip(sharedTag === undefined, 'no tag is on both a post and a note');
  await page.goto(`/tags/${sharedTag}`);
  expect(await listed(page)).toEqual({
    headings: ['Posts', 'Notes'],
    ...expected(sharedTag ?? '', all),
  });
  await expect(page.locator('.column > .caption')).toHaveText('Follow this tag: RSS, Atom.');
});

// Catches a tag feed whose page link leads nowhere: the feed keeps its old page address so
// it does not change (ADR 0021), and that address must reach the tag page.
test("a tag feed's page link reaches the tag page", { tag: '@drafts' }, async ({ request }) => {
  const tag = posts.flatMap((post) => post.tags)[0];
  test.skip(tag === undefined, 'no post has a tag');
  const atom = await (await request.get(`/writing/tags/${tag}/atom.xml`)).text();
  const alternate = /<link rel="alternate" type="text\/html" href="([^"]+)"\/>/.exec(atom)?.[1];
  expect(alternate).toBe(`https://ayagmar.dev/writing/tags/${tag}`);
  const response = await request.get(new URL(alternate ?? '').pathname);
  expect(response.status()).toBe(200);
  expect(new URL(response.url()).pathname).toBe(`/tags/${tag}`);
});

// Catches a post's tags linking to the page's old address or to no page.
test("a post's tags lead to their tag page", { tag: '@drafts' }, async ({ page, request }) => {
  const post = posts.find((p) => p.tags.length > 0);
  test.skip(post === undefined, 'no post has a tag');
  await page.goto(`/writing/${post?.slug}`);
  const hrefs = await page
    .locator('.post-header .tags a')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href')));
  expect(hrefs).toEqual(post?.tags.map((tag) => `/tags/${tag}`));
  for (const href of hrefs) {
    expect((await request.get(href ?? '')).status(), href ?? '').toBe(200);
  }
});
