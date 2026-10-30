// The notes themselves, on the build that shows drafts (`just site-build-preview`, served on
// the second port in playwright.config.ts). The production build holds none while every note is
// a draft, so this is where a note page, the stacked /til page and feeds with entries are
// checked.
import AxeBuilder from '@axe-core/playwright';
import { expectValidFeed } from './feed-rules.ts';
import { expect, test } from './fixtures.ts';
import { notes } from './til-notes.ts';

const newestFirst = notes.toSorted((a, b) => b.date.localeCompare(a.date));
const paths = ['/til', ...newestFirst.map((note) => `/til/${note.slug}`)];
// The note with a command longer than a phone screen. Delete it and this test fails on purpose.
const longLine = 'brace-group-pipe-to-sh';

test.describe('axe, in both themes and at both sizes', () => {
  for (const path of paths) {
    for (const colorScheme of ['light', 'dark'] as const) {
      for (const width of [360, 1280]) {
        test(`${path} in ${colorScheme} at ${width}px`, async ({ page }) => {
          await page.emulateMedia({ colorScheme });
          await page.setViewportSize({ width, height: 800 });
          await page.goto(path);
          await expect(page.getByRole('button', { name: /search/i })).toBeVisible();
          const results = await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
            .analyze();
          expect(results.violations.map((v) => `${v.id}: ${v.nodes.length} nodes`)).toEqual([]);
        });
      }
    }
  }
});

// Catches the link missing from a note, or its subject not being the note's own title.
for (const note of notes) {
  test(`/til/${note.slug} links "Reply by email" with the note's title as the subject`, async ({
    page,
  }) => {
    await page.goto(`/til/${note.slug}`);
    const href = await page.getByRole('link', { name: 'Reply by email' }).getAttribute('href');
    expect(decodeURIComponent((href ?? '').split('subject=')[1] ?? '')).toBe(`Re: ${note.title}`);
  });
}

// Catches a note's thread being keyed by the wrong collection, so notes and posts share threads.
for (const note of notes) {
  test(`/til/${note.slug} offers comments keyed to the note`, async ({ page }) => {
    await page.goto(`/til/${note.slug}`);
    await expect(page.getByRole('region', { name: 'Comments' })).toHaveAttribute(
      'data-term',
      `til/${note.slug}`
    );
  });
}

for (const path of paths) {
  test(`${path} does not scroll sideways at 320px`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(path);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

// Catches a long command that widens the page instead of scrolling inside its block, or a
// block the keyboard cannot scroll.
test('a long code line scrolls inside its block', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(`/til/${longLine}`);
  const block = page.locator('.prose pre').first();
  const { scrolls, inside, focusable } = await block.evaluate((pre) => ({
    scrolls: pre.scrollWidth > pre.clientWidth,
    inside: pre.getBoundingClientRect().right <= document.documentElement.clientWidth,
    focusable: pre.getAttribute('tabindex') === '0',
  }));
  expect({ scrolls, inside, focusable }).toEqual({ scrolls: true, inside: true, focusable: true });
});

// Catches a /til that links notes without showing them, loses a note's date or permalink, or
// shows them oldest first.
test('/til shows every note in full, newest first, each with its date and permalink', async ({
  page,
}) => {
  await page.goto('/til');
  const shown = page.locator('.til-note');
  await expect(shown).toHaveCount(notes.length);
  for (const [index, note] of newestFirst.entries()) {
    const entry = shown.nth(index);
    await expect(entry.locator('time')).toHaveAttribute('datetime', note.date);
    await expect(entry.getByRole('link', { name: note.title })).toHaveAttribute(
      'href',
      `/til/${note.slug}`
    );
    // The body, not a summary: every note here has at least one paragraph of prose.
    expect(await entry.locator('.prose p').count()).toBeGreaterThan(0);
  }
  // The long command is on the page, not only on the note's own.
  await expect(shown.locator('pre')).toContainText('install.sh | sh');
});

test('a note page shows that note alone', async ({ page }) => {
  const note = newestFirst[0];
  if (note === undefined) throw new Error('no notes');
  await page.goto(`/til/${note.slug}`);
  await expect(page.getByRole('heading', { level: 1, name: note.title })).toBeVisible();
  await expect(page.locator('article.reader time')).toHaveAttribute('datetime', note.date);
  await expect(page.locator('.til-note')).toHaveCount(0);
});

test.describe('feeds with entries', () => {
  // Catches an Atom id that follows the title or the file, which readers store: it must be the
  // tag URI of the date and the slug, and the same entries must not reach the writing feeds.
  test('follow the validator rules, newest first, with stable ids', async ({ page, request }) => {
    const ids = await expectValidFeed(page, request, '/til/atom.xml', '/til');
    expect(ids).toEqual(
      newestFirst.map((note) => `tag:ayagmar.dev,${note.date}:/til/${note.slug}`)
    );
    const links = await expectValidFeed(page, request, '/til/feed.xml', '/til');
    expect(links).toEqual(newestFirst.map((note) => `https://ayagmar.dev/til/${note.slug}`));
    for (const writing of ['/feed.xml', '/atom.xml']) {
      expect(await (await request.get(writing)).text()).not.toContain('/til/');
    }
  });
});

// Catches notes missing from the search index, or found without saying they are notes.
test('search finds a note and labels it TIL', async ({ page }) => {
  await page.goto('/about');
  await expect(page.getByRole('button', { name: /search/i })).toBeVisible();
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Search' });
  await dialog.getByLabel('Search posts').fill('brace group');
  const result = dialog.getByRole('link', { name: /^TIL: A brace group/ });
  await expect(result).toHaveAttribute('href', `/til/${longLine}`);
});

test('index.txt lists the latest notes', async ({ request }) => {
  const text = await (await request.get('/index.txt')).text();
  const section = /\nTIL\n([\s\S]*?)\n-{10,}/.exec(text)?.[1] ?? '';
  for (const note of newestFirst) {
    expect(section).toContain(`${note.date}  ${note.title}`);
    expect(section).toContain(`https://ayagmar.dev/til/${note.slug}`);
  }
});
