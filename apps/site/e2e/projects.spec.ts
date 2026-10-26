import { expect, test } from './fixtures.ts';

test('a post about a project shows its card and the other posts on it', async ({ page }) => {
  await page.goto('/writing/token-logs');
  const card = page.getByRole('complementary', { name: 'About llm-usage-metrics' });
  await expect(card.getByRole('link', { name: 'llm-usage-metrics', exact: true })).toHaveAttribute(
    'href',
    '/projects/llm-usage-metrics'
  );
  await expect(card.locator('.project-stats')).toContainText('Stars35');
  await expect(card.getByText('Sample data (fixtures mode).')).toBeVisible();
  const more = card.getByRole('region', { name: 'More on llm-usage-metrics' });
  await expect(more.getByRole('link')).toHaveText([
    'Placeholder: counting cache reads that agents never log',
  ]);

  await page.goto('/writing/ephemeral-runners');
  const only = page.getByRole('complementary', { name: 'About runnerd' });
  await expect(only).toBeVisible();
  await expect(only.getByRole('region')).toHaveCount(0);
});

test('a project page lists its writing newest first and links its feeds', async ({ page }) => {
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

// niri-computer-use only has a draft, which a production build leaves out.
for (const slug of ['headroom', 'niri-computer-use']) {
  test(`${slug} says nothing is written about it yet`, async ({ page, request }) => {
    await page.goto(`/projects/${slug}`);
    await expect(page.getByText(`Nothing written about ${slug} yet.`)).toBeVisible();
    await expect(page.locator('.posts')).toHaveCount(0);
    expect(await (await request.get(`/projects/${slug}/feed.xml`)).text()).not.toContain('<item>');
  });
}

test('the projects index counts published posts per project', async ({ page }) => {
  await page.goto('/projects');
  await expect(page.locator('#llm-usage-metrics .project-post-count')).toHaveText(/^2 posts/);
  await expect(page.locator('#runnerd .project-post-count')).toHaveText(/^1 post/);
  await expect(page.locator('#niri-computer-use .project-post-count')).toHaveText(/^no posts/);
});

test("a project feed carries only that project's posts", async ({ request }) => {
  const rss = await (await request.get('/projects/llm-usage-metrics/feed.xml')).text();
  const links = [...rss.matchAll(/<item>\s*<title>[^<]*<\/title>\s*<link>([^<]+)/g)].map(
    ([, link]) => link
  );
  expect(links).toEqual([
    'https://ayagmar.dev/writing/cache-reads',
    'https://ayagmar.dev/writing/token-logs',
  ]);
});

test('search results name the project a post is about', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: /search/i })).toBeVisible();
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Search' });
  await dialog.getByLabel('Search posts').fill('ephemeral runners');
  const result = dialog.getByRole('listitem').filter({
    has: page.getByRole('link', { name: /ephemeral CI runners/ }),
  });
  await expect(result.locator('.search-projects')).toHaveText('About runnerd');
});

// GitHub descriptions, names and tags are upstream text: one long unbroken token in any of
// them must wrap instead of pushing the page sideways on a phone.
for (const path of ['/projects/pi-mobile', '/projects', '/writing/token-logs']) {
  for (const width of [320, 360]) {
    test(`${path} wraps long project metadata at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(path);
      const filled = await page
        .locator(
          '.project-summary, .projects p, .project-stats dd, .project-links a, .project h1, h2 a'
        )
        .evaluateAll((elements) => {
          for (const element of elements) element.textContent = 'A'.repeat(80);
          return elements.length;
        });
      expect(filled).toBeGreaterThan(2);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
}
