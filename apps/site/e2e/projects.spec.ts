// Tests that need a post carry @drafts and run on the build that shows drafts, where the
// placeholder drafts in content/writing are posts (playwright.config.ts).
import { expect, test } from './fixtures.ts';

test('a post about a project shows its card and the other posts on it', { tag: '@drafts' }, async ({
  page,
}) => {
  await page.goto('/writing/token-logs');
  const card = page.getByRole('complementary', { name: 'About llm-usage-metrics' });
  await expect(card.getByRole('link', { name: 'llm-usage-metrics', exact: true })).toHaveAttribute(
    'href',
    '/projects/llm-usage-metrics'
  );
  await expect(card.locator('.project-stats')).toContainText('Stars35');
  await expect(card.getByText('Sample data, not live')).toBeVisible();
  const more = card.getByRole('region', { name: 'More on llm-usage-metrics' });
  await expect(more.getByRole('link')).toHaveText([
    'Placeholder: counting cache reads that agents never log',
  ]);

  await page.goto('/writing/ephemeral-runners');
  const only = page.getByRole('complementary', { name: 'About runnerd' });
  await expect(only).toBeVisible();
  await expect(only.getByRole('region')).toHaveCount(0);
});

test('a project page lists its writing newest first and links its feeds', {
  tag: '@drafts',
}, async ({ page }) => {
  await page.goto('/projects/llm-usage-metrics');
  await expect(page.locator('.posts a')).toHaveText([
    'Placeholder: counting cache reads that agents never log',
    'Placeholder: what 17 coding agents taught me about token logs',
  ]);
  const feeds = await page
    .locator('link[rel="alternate"]')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href')));
  expect(feeds).toEqual([
    '/feed.xml',
    '/atom.xml',
    '/projects/llm-usage-metrics/feed.xml',
    '/projects/llm-usage-metrics/atom.xml',
  ]);
});

// Catches an empty section and two empty feeds at the end of a project page (niri-computer-use
// only has a draft, which a production build leaves out), and a feed or a next step that is
// missing or wrong: releases only for a project that has one, next in /projects order.
for (const [slug, releases, next] of [
  ['dotfiles', false, 'runnerd'],
  ['niri-computer-use', true, 'dotfiles'],
] as const) {
  test(`${slug} ends on what to follow and the next project`, async ({ page, request }) => {
    await page.goto(`/projects/${slug}`);
    await expect(page.getByRole('heading', { name: `Writing about ${slug}` })).toHaveCount(0);
    await expect(page.getByText('Follow writing about')).toHaveCount(0);
    expect(
      await page
        .locator('link[rel="alternate"]')
        .evaluateAll((links) => links.map((link) => link.getAttribute('href')))
    ).toEqual(['/feed.xml', '/atom.xml']);
    expect(await (await request.get(`/projects/${slug}/feed.xml`)).text()).not.toContain('<item>');
    const end = page.locator('.project-end');
    await expect(end.getByRole('link', { name: 'Follow releases' })).toHaveCount(releases ? 1 : 0);
    if (releases) {
      await expect(end.getByRole('link', { name: 'Follow releases' })).toHaveAttribute(
        'href',
        `https://github.com/ayagmar/${slug}/releases.atom`
      );
    }
    await expect(end.getByRole('link', { name: `Next: ${next} →` })).toHaveAttribute(
      'href',
      `/projects/${next}`
    );
  });
}

// Catches the page's "Next" and /projects disagreeing, a dead end on the last project, and a
// project left out of the round.
test('Next goes through every project in /projects order and back to the first', async ({
  page,
}) => {
  await page.goto('/projects');
  const order = await page
    .locator('.projects h3 a[href^="/projects/"]')
    .evaluateAll((links) => links.map((link) => link.textContent?.trim() ?? ''));
  expect(order).toHaveLength(13);
  const seen: string[] = [];
  let slug = order[0] ?? '';
  while (seen.length < order.length) {
    seen.push(slug);
    await page.goto(`/projects/${slug}`);
    const href = await page.locator('.project-end a[rel="next"]').getAttribute('href');
    slug = href?.replace('/projects/', '') ?? '';
  }
  expect(seen).toEqual(order);
  expect(slug).toBe(order[0]);
});

// Catches the way to get a project sinking below the fold again, a copy button that shows
// without the Clipboard API, and a "No release yet" on a project that has releases.
test('how to get a project is under its title, above the fold on a phone', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await context.newPage();
  await page.goto('/projects/llm-usage-metrics');
  const header = page.locator('.project > header');
  const install = header.locator('.project-install');
  await expect(install.locator('code')).toHaveText('npm install -g llm-usage-metrics');
  const links = header.locator('.project-links a');
  await expect(links).toHaveText(['Source on GitHub', 'npm package']);
  expect(await links.evaluateAll((all) => all.map((link) => link.getAttribute('href')))).toEqual([
    'https://github.com/ayagmar/llm-usage-metrics',
    'https://www.npmjs.com/package/llm-usage-metrics',
  ]);
  const bottom = await links.last().evaluate((link) => link.getBoundingClientRect().bottom);
  expect(bottom).toBeLessThan(844);
  await expect(page.getByRole('heading', { name: 'Links' })).toHaveCount(0);
  await install.getByRole('button', { name: 'Copy' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'npm install -g llm-usage-metrics'
  );

  await page.goto('/projects/kipple');
  await expect(page.locator('.project-install')).toHaveCount(0);
  await expect(page.locator('.project > header .project-links li')).toHaveText(
    'No release yet: build from source'
  );
  await context.close();
});

// Catches the command needing JavaScript: without it there is no button, and the text is there
// to select.
test('without JavaScript the command shows with no copy button', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/projects/pi-extmgr');
  await expect(page.locator('.project-install code')).toHaveText('pi install npm:pi-extmgr');
  await expect(page.locator('.project-install button')).toBeHidden();
  await context.close();
});

// Catches a row repeating a status every row shares, a number below its floor beating a
// stronger one, and a number shown for a project signals does not fetch (ADR 0051).
test('each project row says its strongest fact and its posts', { tag: '@drafts' }, async ({
  page,
}) => {
  await page.goto('/projects');
  await expect(page.locator('#llm-usage-metrics .project-label')).toHaveText('35 stars, 2 posts');
  await expect(page.locator('#runnerd .project-label')).toHaveText('v0.0.17, 1 post');
  await expect(page.locator('#ccdesk .project-label')).toHaveText('1.6k downloads a month');
  await expect(page.locator('#dotfiles .project-label')).toBeHidden();
  await expect(page.getByText('Sample data, not live')).toHaveCount(1);
});

// Catches a row where only the 21 px name is a link, or one that reads as two links (ADR 0051).
for (const path of ['/', '/projects']) {
  test(`${path}: each project row is one link at least 44 px tall`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(path);
    const row = page.locator('.projects li:visible').filter({ hasText: 'pi-mobile' });
    await expect(row.getByRole('link')).toHaveCount(1);
    await row.scrollIntoViewIfNeeded();
    const box = await row.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    // The summary's own box: the link stretched over the row takes the click.
    const summary = await row.locator('p').first().boundingBox();
    await page.mouse.click((summary?.x ?? 0) + 4, (summary?.y ?? 0) + 4);
    await expect(page).toHaveURL(/\/projects\/pi-mobile$/);
  });
}

test("a project feed carries only that project's posts", { tag: '@drafts' }, async ({
  request,
}) => {
  const rss = await (await request.get('/projects/llm-usage-metrics/feed.xml')).text();
  const links = [...rss.matchAll(/<item>\s*<title>[^<]*<\/title>\s*<link>([^<]+)/g)].map(
    ([, link]) => link
  );
  expect(links).toEqual([
    'https://ayagmar.dev/writing/cache-reads',
    'https://ayagmar.dev/writing/token-logs',
  ]);
});

test('search results name the project a post is about', { tag: '@drafts' }, async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: /search/i })).toBeVisible();
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Search' });
  await dialog.getByLabel('Search the site').fill('ephemeral runners');
  const result = dialog.getByRole('listitem').filter({
    has: page.getByRole('link', { name: /ephemeral CI runners/ }),
  });
  await expect(result.locator('.search-projects')).toHaveText('About runnerd');
});

// GitHub descriptions, names and tags are upstream text: one long unbroken token in any of
// them must wrap instead of pushing the page sideways on a phone. Post titles too: on home, one
// long word in a grid track widens every panel. On the drafts build, so home lists posts.
for (const path of ['/', '/projects/pi-mobile', '/projects', '/writing/token-logs']) {
  test(`${path} wraps long metadata at 320, 360 and 390px`, { tag: '@drafts' }, async ({
    page,
  }) => {
    await page.goto(path);
    const filled = await page
      .locator(
        '.project-summary, .projects p, .project-stats dd, .project-links a, .project h1, h2 a:not(.heading-link), .projects h3 a, .home-projects a, .home-projects p, .posts a'
      )
      .evaluateAll((elements) => {
        for (const element of elements) element.textContent = 'A'.repeat(80);
        return elements.length;
      });
    expect(filled).toBeGreaterThan(2);
    for (const width of [320, 360, 390]) {
      await page.setViewportSize({ width, height: 800 });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(overflow, `${width}px`).toBeLessThanOrEqual(0);
    }
  });
}

// Catches the plugins section dropping off /projects or its text copy, or a plugin linking
// anywhere but its directory in Noctalia's community list.
test('/projects ends with the Noctalia plugins, which have no pages of their own', async ({
  page,
  request,
}) => {
  const directory = 'https://github.com/noctalia-dev/community-plugins/tree/main';
  const urls = [`${directory}/headroom`, `${directory}/binance`, `${directory}/obs-control`];
  await page.goto('/projects');
  const section = page.getByRole('region', { name: 'Noctalia plugins' });
  await expect(page.locator('.column > section').last()).toHaveId('noctalia-plugins');
  await expect(section.getByRole('heading', { level: 3 })).toHaveText([
    'Headroom',
    'Binance',
    'OBS Control',
  ]);
  expect(
    await section
      .locator('h3 a')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href')))
  ).toEqual(urls);
  const text = await (await request.get('/projects.txt')).text();
  for (const url of urls) expect(text).toContain(`  ${url}\n`);
});

// Catches a plugin's thumbnail missing from its row or served broken.
test('each Noctalia plugin shows its thumbnail from the site', async ({ page, request }) => {
  await page.goto('/projects');
  const rows = page.locator('#noctalia-plugins li');
  const sources = await rows.evaluateAll((items) =>
    items.map(
      (item) => item.querySelector('img.plugin-thumb, .plugin-thumb img')?.getAttribute('src') ?? ''
    )
  );
  expect(sources).toHaveLength(3);
  for (const src of sources) {
    expect(src).toMatch(/^\/_astro\/[\w.-]+\.webp$/);
    expect((await request.get(src)).headers()['content-type'], src).toBe('image/webp');
  }
});

// Catches a day and night pair showing both screenshots or neither, without scripts or against
// a stored choice, or the hidden one downloaded anyway. Browsers load lazy images at once when
// scripts are off, so only pages with scripts can skip the hidden one (ADR 0049).
for (const { scheme, stored, script, shown } of [
  { scheme: 'light', stored: null, script: false, shown: 'day' },
  { scheme: 'dark', stored: null, script: false, shown: 'night' },
  { scheme: 'dark', stored: 'day', script: true, shown: 'day' },
  { scheme: 'light', stored: 'night', script: true, shown: 'night' },
] as const) {
  test(`runnerd's screenshot is the ${shown} one for a ${scheme} system with ${stored ?? 'no'} choice${script ? '' : ', without scripts'}`, async ({
    browser,
  }) => {
    const context = await browser.newContext({ colorScheme: scheme, javaScriptEnabled: script });
    if (stored !== null)
      await context.addInitScript((theme) => localStorage.setItem('theme', theme), stored);
    const page = await context.newPage();
    const fetched: string[] = [];
    page.on('requestfinished', (request) => {
      const file = new URL(request.url()).pathname;
      if (file.startsWith('/_astro/runnerd-')) fetched.push(file);
    });
    await page.goto('/projects/runnerd');
    const visible = page.locator('.project-shot img:visible');
    await expect(visible).toHaveCount(1);
    await expect(visible).toHaveAttribute('src', new RegExp(`^/_astro/runnerd-${shown}\\.`));
    await expect(visible).toHaveJSProperty('complete', true);
    if (script) {
      await expect.poll(() => fetched.length).toBeGreaterThan(0);
      expect(fetched.filter((file) => !file.startsWith(`/_astro/runnerd-${shown}.`))).toEqual([]);
    }
    await context.close();
  });
}

// Catches the screenshot losing its size (a layout shift), its alt text, or its link to the
// full-size file, and a project without one drawing an empty frame.
test("a project's screenshot is sized, described and links to the full image", async ({
  page,
  request,
}) => {
  await page.goto('/projects/pi-extmgr');
  const image = page.locator('.project-shot img');
  await expect(image).toHaveAttribute('width', '672');
  await expect(image).toHaveAttribute('height', '211');
  await expect(image).toHaveAttribute('loading', 'eager');
  await expect(image).toHaveAttribute(
    'alt',
    'The Installed screen in Pi: local extensions and npm and git packages on the left, the selected package on the right.'
  );
  const full = await page.locator('.project-shot a').getAttribute('href');
  expect(full).toMatch(/^\/_astro\/pi-extmgr\.[\w-]+\.png$/);
  expect((await request.get(full ?? '')).headers()['content-type']).toBe('image/png');
  await page.goto('/projects/repo-pulse');
  await expect(page.locator('.project-shot')).toHaveCount(0);
});

// Catches the redirects from headroom's old page and copy being dropped (the Worker and
// _redirects, ADR 0047), or the section they point at losing its id.
test("headroom's old page and copy move to the plugins section for good", async ({
  page,
  request,
}) => {
  for (const [path, target] of [
    ['/projects/headroom', '/projects#noctalia-plugins'],
    ['/projects/headroom.txt', '/projects.txt'],
  ] as const) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(301);
    const location = new URL(response.headers().location ?? '', 'http://127.0.0.1');
    expect(location.pathname + location.hash, path).toBe(target);
  }
  await page.goto('/projects/headroom');
  await expect(page.locator('#noctalia-plugins')).toHaveAccessibleName('Noctalia plugins');
});
