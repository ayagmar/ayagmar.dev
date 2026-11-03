// The post reader on a phone (ADR 0026): text near the screen edges, a one-row header, and both
// themes readable.
import { expect, expectNoAxeViolations, test } from './fixtures.ts';

// A placeholder draft, so these tests run on the drafts build.
const post = '/writing/token-logs';

test.describe('on a 390px phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  // Catches card chrome or a paper margin coming back and squeezing the text column.
  test('the post text runs nearly edge to edge', { tag: '@drafts' }, async ({ page }) => {
    await page.goto(post);
    const box = await page.locator('.reader > .prose').boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(390 - 2 * 20);
  });

  // Catches a header that wraps to several rows again, a keyboard hint on a touch screen, or a
  // nav that the Menu button cannot reach.
  test('the header is one row and Menu opens the nav and the theme switch', {
    tag: '@drafts',
  }, async ({ page }) => {
    await page.goto(post);
    await expect(page.getByRole('button', { name: /search/i })).toBeVisible();
    const header = await page.locator('.site-header').boundingBox();
    expect(header?.height).toBeLessThan(64);
    for (const hint of await page.locator('.site-header kbd').all())
      await expect(hint).toBeHidden();

    const nav = page.getByRole('navigation', { name: 'Site' });
    await expect(nav).toBeHidden();
    await page.getByRole('button', { name: 'Menu' }).click();
    await expect(nav.getByRole('link', { name: 'TIL' })).toBeVisible();
    await expect(nav.getByRole('group', { name: 'Theme' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(nav).toBeHidden();
  });
});

// Catches a Menu panel taller than a short landscape phone, which leaves the theme switch below
// the screen with no way to scroll to it.
test.describe('on a 568x320 landscape phone', () => {
  test.use({ viewport: { width: 568, height: 320 }, hasTouch: true });

  test('Menu scrolls inside itself so a theme button can be pressed', { tag: '@drafts' }, async ({
    page,
  }) => {
    await page.goto(post);
    await page.getByRole('button', { name: 'Menu' }).click();
    const theme = page.getByRole('group', { name: 'Theme' });
    await theme.getByRole('button', { name: 'Night' }).click({ timeout: 3000 });
    await expect(theme.getByRole('button', { pressed: true })).toHaveText('Night');
  });
});

// Catches a Menu left open on a phone staying a floating panel after the window grows to the
// desktop layout (a rotated tablet, a resized window), where the nav row should be in the header.
test('an open Menu closes when the window grows to the desktop layout', { tag: '@drafts' }, async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(post);
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.locator('#site-menu')).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 800 });
  const link = page.getByRole('navigation', { name: 'Site' }).getByRole('link', { name: 'TIL' });
  await expect(link).toBeVisible();
  const header = await page.locator('.site-header').boundingBox();
  const box = await link.boundingBox();
  expect(box?.y).toBeLessThan((header?.y ?? 0) + (header?.height ?? 0));
  await expect(page.locator('#site-menu')).not.toHaveJSProperty('popoverOpen', true);
});

// Catches reader colours (text, links, the quote and rule pixels, the paper diagram cards) that
// pass in day and fail on the night ground; pages.spec.ts checks the day.
for (const width of [360, 1280]) {
  test(`a post has no axe violations at night at ${width}px`, { tag: '@drafts' }, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.setViewportSize({ width, height: 800 });
    await page.goto(post);
    await expect(page.getByRole('button', { name: /search/i })).toBeVisible();
    await expectNoAxeViolations(page);
  });
}

test.describe('the copy button on a code block', () => {
  // Catches the button copying its own label or the wrong block, a diagram getting a button,
  // and a copy that screen readers never hear about.
  test('copies the code and says so', { tag: '@drafts' }, async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto(post);
    const copy = page.locator('.prose').getByRole('button', { name: 'Copy' });
    await expect(copy).toHaveCount(await page.locator('.prose pre').count());
    await expect(page.locator('.prose .diagram button')).toHaveCount(0);

    await page.locator('.prose pre').first().focus();
    await page.keyboard.press('Tab');
    await expect(copy.first()).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('.prose').getByRole('status').first()).toHaveText('Copied');
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe('llm-usage --json --since 2026-10-01\n');
  });

  // Catches a button that does nothing where the Clipboard API is missing (plain http).
  test('is not there without the Clipboard API', { tag: '@drafts' }, async ({ page }) => {
    await page.addInitScript(() =>
      Object.defineProperty(Navigator.prototype, 'clipboard', { value: undefined })
    );
    await page.goto(post);
    await expect(page.locator('.prose pre').first()).toBeVisible();
    await expect(page.locator('.prose').getByRole('button', { name: 'Copy' })).toHaveCount(0);
  });

  test.describe('on a 712px touch screen', () => {
    test.use({ viewport: { width: 712, height: 1000 }, hasTouch: true });

    // Catches the band above the first line lost from 40rem, where touch screens always show the
    // button and it then covers the start of the code.
    test('sits above the first line of code', { tag: '@drafts' }, async ({ page }) => {
      await page.goto(post);
      const block = page.locator('.prose .code-block').first();
      await expect(block.getByRole('button', { name: 'Copy' })).toBeVisible();
      const { button, line } = await block.evaluate((element) => ({
        button: element.querySelector('button')?.getBoundingClientRect().bottom ?? 0,
        line: element.querySelector('code')?.getClientRects()[0]?.top ?? 0,
      }));
      expect(button).toBeLessThanOrEqual(line);
    });
  });
});

// Catches a section's `#` link pointing at an id the page lacks, the `#` leaking into the
// heading's text (and so the table of contents), and a link the keyboard reaches but cannot see.
test('each section heading links to itself', { tag: '@drafts' }, async ({ page }) => {
  await page.goto(post);
  const headings = page.locator('.prose :is(h2, h3):not(.sr-only)');
  expect(await headings.count()).toBeGreaterThan(0);
  for (const heading of await headings.all()) {
    const id = await heading.getAttribute('id');
    const link = heading.getByRole('link', { name: 'Link to this section' });
    await expect(link).toHaveAttribute('href', `#${id}`);
    expect(await heading.textContent()).not.toContain('#');
  }
  const first = headings.first().getByRole('link');
  await expect(first).toHaveCSS('opacity', '0');
  await first.focus();
  await expect(first).toHaveCSS('opacity', '1');
  await page.keyboard.press('Enter');
  expect(new URL(page.url()).hash).toBe(`#${await headings.first().getAttribute('id')}`);
});

// Catches a series line stretching the rows beside a long contents list at desktop width, which
// leaves an empty band between the header and the text. No post has a series, that many headings
// or that much text yet, so the test adds them in SeriesLine.astro's and Toc.astro's markup.
test('a contents list beside a series post does not push its text down', {
  tag: '@drafts',
}, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // Without art the header is shorter than the contents list.
  await page.goto('/writing/ricing-niri');
  const textTop = () =>
    page.locator('.reader > .prose').evaluate((prose: HTMLElement) => prose.offsetTop);
  await page.locator('.reader').evaluate((reader) => {
    reader
      .querySelector('.post-header')
      ?.insertAdjacentHTML(
        'afterend',
        '<nav class="series"><p>Part 1 of 2</p><ol><li><span aria-current="page">One</span></li><li><a href="#">Two</a></li></ol></nav>'
      );
    reader
      .querySelector('.prose')
      ?.insertAdjacentHTML('beforeend', '<p>A long part.</p>'.repeat(40));
  });
  const withoutContents = await textTop();
  await page.locator('.series').evaluate((line) => {
    const items = Array.from(
      { length: 13 },
      (_, i) => `<li><a href="#s${i}">Section ${i}</a></li>`
    );
    line.insertAdjacentHTML(
      'afterend',
      `<details class="toc"><summary>On this page</summary><ol>${items.join('')}</ol></details>`
    );
  });
  expect(await textTop()).toBe(withoutContents);
});
