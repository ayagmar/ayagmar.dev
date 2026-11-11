// A project's numbers and its log of releases and merges, kept current by the browser (ADR 0015).
// The e2e build runs in fixtures mode, where the page asks signals for nothing. Each test turns
// the page's panels live as an api mode build would (an endpoint, and a freshness line where the
// sample tape is), answers the API itself, and fixes the browser's clock.
import { snapshotFixtures } from '@min7/contracts/fixtures';
import type { Browser, Locator, Page, Route } from '@playwright/test';
import { expect, test } from './fixtures.ts';

const api = 'https://api.ayagmar.dev/v1';
type Source = 'projects' | 'shipping';
type Answer = Parameters<Route['fulfill']>[0] | ((route: Route) => unknown);
// The build's snapshots were taken at 09:00 (fixturesCapturedAt).
const noon = '2026-10-26T12:00:00Z';

const envelope = (
  source: Source,
  data: unknown = snapshotFixtures[source].ok,
  fetchedAt = '2026-10-26T11:59:00Z'
) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ source, version: 1, fetchedAt, stale: false, data }),
});

/** Opens `path` at noon with the panels of `answers` live, each answered as given. */
async function visit(page: Page, path: string, answers: Partial<Record<Source, Answer>>) {
  await page.clock.install({ time: noon });
  await page.route(`**${path}`, async (route) => {
    const response = await route.fetch();
    let html = await response.text();
    for (const source of Object.keys(answers)) {
      html = html.replace(
        new RegExp(`(data-live="${source}"[^>]*>[^]*?)<p class="sample">[^<]*</p>`, 'g'),
        '$1<p class="freshness"></p>'
      );
      html = html.replaceAll(
        `data-live="${source}"`,
        `data-live="${source}" data-live-src="${api}/${source}"`
      );
    }
    await route.fulfill({ response, body: html });
  });
  await page.route(`${api}/**`, (route) => {
    const source = new URL(route.request().url()).pathname.split('/').at(-1) as Source;
    const answer = answers[source];
    if (answer === undefined) return route.abort();
    return typeof answer === 'function' ? answer(route) : route.fulfill(answer);
  });
  await page.goto(path);
}

const numbers = (page: Page) => page.locator('[data-live="projects"]');
const log = (page: Page) => page.locator('[data-live="shipping"]');

/** The markup under `locator` as text, whitespace collapsed, without the build's comments. */
const html = (locator: Locator) =>
  locator.evaluate((root) => {
    const copy = root.cloneNode(true) as Element;
    const walker = document.createTreeWalker(copy, NodeFilter.SHOW_COMMENT);
    const comments: Node[] = [];
    while (walker.nextNode()) comments.push(walker.currentNode);
    for (const comment of comments) comment.parentNode?.removeChild(comment);
    return copy.innerHTML.replace(/\s+/g, ' ').replace(/> </g, '><');
  });

// Catches the browser's renderer drifting from the build's: the same snapshots, built into the
// page or read live, must give the same numbers and log, links and times included.
test('a live answer renders as the build renders the same snapshot', async ({ page }) => {
  await page.clock.install({ time: noon });
  await page.goto('/projects/pi-extmgr');
  const built = [
    await html(numbers(page).locator('.project-numbers-body')),
    await html(log(page).locator('.project-log-body')),
  ];

  await page.unrouteAll();
  const fresh = await page.context().newPage();
  await visit(fresh, '/projects/pi-extmgr', {
    projects: envelope('projects'),
    shipping: envelope('shipping'),
  });
  for (const panel of [numbers(fresh), log(fresh)]) {
    await expect(panel.locator('.freshness time')).toHaveAttribute(
      'datetime',
      '2026-10-26T11:59:00Z'
    );
  }
  expect([
    await html(numbers(fresh).locator('.project-numbers-body')),
    await html(log(fresh).locator('.project-log-body')),
  ]).toEqual(built);
});

const projects = snapshotFixtures.projects.ok.projects;
const runnerd = projects.find((project) => project.slug === 'runnerd');

// Catches the page keeping the build's release after a newer one is out: /projects/runnerd said
// v0.0.29 while /v1/projects said v0.1.0.
test('a newer release replaces the one the build showed', async ({ page }) => {
  const release = {
    tag: 'v0.1.0',
    url: 'https://github.com/ayagmar/runnerd/releases/tag/v0.1.0',
    publishedAt: '2026-10-26T11:00:00Z',
  };
  await visit(page, '/projects/runnerd', {
    projects: envelope('projects', {
      projects: projects.map((project) =>
        project === runnerd ? { ...project, stars: 40, latestRelease: release } : project
      ),
    }),
  });
  await expect(numbers(page).locator('dd')).toHaveText(['Rust', '40', 'v0.1.0, 2026-10-26']);
  await expect(numbers(page).getByRole('link', { name: 'v0.1.0' })).toHaveAttribute(
    'href',
    release.url
  );
  await expect(numbers(page).locator('.freshness')).toHaveText('Updated 1 minute ago');
});

// Catches numbers kept under a newer time for a project the newest snapshot leaves out (GitHub
// did not answer for it, or it went private).
test('a project missing from the answer has no numbers', async ({ page }) => {
  await visit(page, '/projects/runnerd', {
    projects: envelope('projects', {
      projects: projects.filter((project) => project !== runnerd),
    }),
  });
  await expect(numbers(page).locator('.project-numbers-body')).toHaveText(
    'No live numbers for runnerd right now.'
  );
});

// Catches signals being down, or answering with something that is not a snapshot, blanking the
// build's numbers and log.
test('a failed or invalid answer keeps the build', async ({ page }) => {
  await visit(page, '/projects/pi-extmgr', {
    projects: { status: 502, body: '' },
    shipping: envelope('shipping', { events: 'none' }),
  });
  await expect(numbers(page).locator('.freshness')).toHaveText('Updated 3 hours ago');
  await expect(numbers(page).locator('dd').nth(1)).toHaveText('72');
  await expect(log(page).locator('li')).toHaveCount(4);
});

// Catches an empty box on a project with nothing recent, and a log that never appears once the
// feed has something for it.
test('the log shows only while the feed has something for the project', async ({ page }) => {
  const merge = {
    type: 'merge',
    repo: 'ayagmar/headroom',
    at: '2026-10-26T11:30:00Z',
    url: 'https://github.com/ayagmar/headroom/pull/3',
    number: 3,
    title: 'docs: say it is archived',
  };
  let answer = envelope('shipping', { events: [], starHistory: [] });
  await visit(page, '/projects/headroom', { shipping: (route) => route.fulfill(answer) });
  await expect(log(page).locator('.freshness')).toHaveText('Updated 1 minute ago');
  await expect(log(page)).toBeHidden();
  answer = envelope('shipping', { events: [merge], starHistory: [] }, '2026-10-26T12:04:00Z');
  // Five minutes on, the next request brings the merge.
  await page.clock.runFor(5 * 60_000);
  await expect(log(page)).toBeVisible();
  await expect(log(page).locator('li')).toHaveText(
    '35 minutes ago merged #3: docs: say it is archived'
  );
  await expect(log(page).getByRole('link')).toHaveAttribute('href', merge.url);
});

// Catches each push to signals redrawing an unchanged log: the fold the reader opened closed,
// and the link they had reached with the keyboard lost focus.
test('a newer answer with the same events keeps the open fold and the focus', async ({ page }) => {
  let answer = envelope('shipping');
  await visit(page, '/projects/ccdesk', { shipping: (route) => route.fulfill(answer) });
  const freshness = log(page).locator('.freshness time');
  await expect(freshness).toHaveAttribute('datetime', '2026-10-26T11:59:00Z');
  await log(page).locator('details summary').click();
  const link = log(page).locator('details a').first();
  await link.focus();
  answer = envelope('shipping', snapshotFixtures.shipping.ok, '2026-10-26T12:04:00Z');
  await page.clock.runFor(5 * 60_000);
  await expect(freshness).toHaveAttribute('datetime', '2026-10-26T12:04:00Z');
  await expect(log(page).locator('details')).toHaveAttribute('open', '');
  await expect(link).toBeFocused();
});

const newPage = async (browser: Browser, options: Parameters<Browser['newContext']>[0]) =>
  (await browser.newContext(options)).newPage();

// Catches a log that needs JavaScript to appear, or an empty one drawn as a box.
test('without JavaScript the build shows the log, or nothing', async ({ browser }) => {
  const page = await newPage(browser, { javaScriptEnabled: false });
  await page.goto('/projects/pi-extmgr');
  await expect(page.getByRole('heading', { name: 'Recently shipped' })).toBeVisible();
  await expect(log(page).locator('li').first()).toHaveText('21 Oct, 19:38 released v0.4.2');
  await page.goto('/projects/headroom');
  await expect(page.getByRole('heading', { name: 'Recently shipped' })).toBeHidden();
  await expect(page.getByText("I don't fetch numbers for headroom.")).toBeVisible();
  await page.context().close();
});

// Catches the card under a post keeping the build's numbers while its project page moves on.
test('the card under a post keeps its numbers current', { tag: '@drafts' }, async ({ page }) => {
  await visit(page, '/writing/token-logs', {
    projects: envelope('projects', {
      projects: projects.map((project) =>
        project.slug === 'llm-usage-metrics' ? { ...project, stars: 99 } : project
      ),
    }),
  });
  const card = page.getByRole('complementary', { name: 'About llm-usage-metrics' });
  await expect(card.locator('.project-stats')).toContainText('Stars99');
  await expect(card.locator('.freshness')).toHaveText('Updated 1 minute ago');
});
