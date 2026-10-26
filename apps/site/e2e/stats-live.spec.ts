// /stats's listening, shipping, projects and typing panels, kept current by the browser (ADR 0015). The
// e2e build runs in fixtures mode, where the page asks signals for nothing. Each test below
// turns a panel live as an api mode build would (its endpoint, and a freshness line where the
// sample tape is), answers the API itself, and fixes the browser's clock.
import { snapshotFixtures } from '@min7/contracts/fixtures';
import type { Browser, Locator, Page, Route } from '@playwright/test';
import { expect, test } from './fixtures.ts';

const api = 'https://api.ayagmar.dev/v1';
const sources = ['listening', 'shipping', 'projects', 'monkeytype'] as const;
type Source = (typeof sources)[number];
// The build's snapshots were taken at 09:00 (fixturesCapturedAt).
const noon = '2026-10-26T12:00:00Z';

type Answer = Parameters<Route['fulfill']>[0] | ((route: Route) => unknown);

const json = (body: unknown) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

/** A `/v1/<source>` answer with the ok fixture, or `data`, fetched at `fetchedAt`. */
const envelope = (
  source: Source,
  { fetchedAt = '2026-10-26T11:59:00Z', stale = false, data = undefined as unknown } = {}
) =>
  json({
    source,
    version: 1,
    fetchedAt,
    stale,
    data: data === undefined ? snapshotFixtures[source].ok : data,
  });

/**
 * Opens /stats at `time` with the panels in `answers` live, each answered as given. Returns the
 * URLs the page asked signals for.
 */
async function visit(page: Page, time: string, answers: Partial<Record<Source, Answer>>) {
  const asked: string[] = [];
  await page.clock.install({ time });
  await page.route('**/stats', async (route) => {
    const response = await route.fetch();
    let html = await response.text();
    for (const source of Object.keys(answers)) {
      html = html.replace(
        new RegExp(`(data-live="${source}"[^>]*>[^]*?)<p class="sample">[^<]*</p>`),
        '$1<p class="freshness"></p>'
      );
      html = html.replace(
        `data-live="${source}"`,
        `data-live="${source}" data-live-src="${api}/${source}"`
      );
    }
    await route.fulfill({ response, body: html });
  });
  await page.route(`${api}/**`, (route) => {
    asked.push(route.request().url());
    const source = new URL(route.request().url()).pathname.split('/').at(-1) as Source;
    const answer = answers[source];
    if (answer === undefined) return route.abort();
    return typeof answer === 'function' ? answer(route) : route.fulfill(answer);
  });
  await page.goto('/stats');
  return asked;
}

const panel = (page: Page, source: Source) => page.locator(`[data-live="${source}"]`);
const freshness = (page: Page, source: Source) => panel(page, source).locator('.freshness');

/** The panel's markup as a tree of tags, attributes and text, whitespace collapsed. */
const tree = (locator: Locator) =>
  locator.evaluate((root) => {
    const walk = (node: Node): unknown => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent?.replace(/\s+/g, ' ');
      // Comments are the build's notes to readers of the source.
      if (node.nodeType !== Node.ELEMENT_NODE) return '';
      const element = node as Element;
      return [
        element.tagName,
        Object.fromEntries([...element.attributes].map((a) => [a.name, a.value])),
        // Adjacent text nodes join, as the page shows them.
        [...element.childNodes]
          .map(walk)
          .reduce<unknown[]>((all, child) => {
            const last = all.at(-1);
            if (typeof child === 'string' && typeof last === 'string')
              all[all.length - 1] = last + child;
            else all.push(child);
            return all;
          }, [])
          .filter((child) => child !== ' ' && child !== ''),
      ];
    };
    return walk(root);
  });

const bodies = {
  listening: '.listening-body',
  shipping: '.shipping-body',
  projects: '.projects-body',
  monkeytype: '.typing-body',
};

// Catches the live renderer drifting from the page's own markup: the same snapshot, built into
// the page or read live, must give the same panels, links and times.
test('a live answer renders as the build renders the same snapshot', async ({ page }) => {
  await page.clock.install({ time: noon });
  await page.goto('/stats');
  const built = await Promise.all(
    sources.map((source) => tree(panel(page, source).locator(bodies[source])))
  );

  await page.unrouteAll();
  const fresh = await page.context().newPage();
  await visit(fresh, noon, Object.fromEntries(sources.map((source) => [source, envelope(source)])));
  for (const source of sources) {
    // Replaced: the line now dates the answer, not the build.
    await expect(freshness(fresh, source).locator('time')).toHaveAttribute(
      'datetime',
      '2026-10-26T11:59:00Z'
    );
  }
  const live = await Promise.all(
    sources.map((source) => tree(panel(fresh, source).locator(bodies[source])))
  );
  expect(live).toEqual(built);
});

test('a newer answer replaces what the build showed', async ({ page }) => {
  const { ok } = snapshotFixtures.listening;
  await visit(page, noon, {
    listening: envelope('listening', {
      data: { ...ok, scrobbles: { thisWeek: 999, lastWeek: null }, recent: ok.recent.slice(0, 1) },
    }),
    shipping: envelope('shipping', {
      data: {
        events: [
          {
            type: 'merge',
            repo: 'ayagmar/runnerd',
            at: '2026-10-26T11:50:00Z',
            url: 'https://github.com/ayagmar/runnerd/pull/7',
            number: 7,
            title: 'Live stats',
          },
        ],
        starHistory: [],
      },
    }),
    projects: envelope('projects', { data: snapshotFixtures.projects.partial }),
    monkeytype: envelope('monkeytype', { data: snapshotFixtures.monkeytype.partial }),
  });
  await expect(page.locator('.now-playing')).toHaveText(
    'Now playing Friendships and Love by Rocketship'
  );
  await expect(panel(page, 'listening').locator('dd')).toHaveText(['999', 'unknown']);
  await expect(
    panel(page, 'listening').locator('.listening-body ol').first().locator('li')
  ).toHaveText(['Half Right by Heatmiser, 3 hours ago']);
  await expect(panel(page, 'shipping').locator('.shipping li')).toHaveText([
    '10 minutes ago runnerd merged #7: Live stats',
  ]);
  await expect(panel(page, 'shipping').getByRole('heading', { name: 'Stars' })).toHaveCount(0);
  await expect(panel(page, 'projects').locator('.projects-body')).toHaveText(
    '7 featured projects, at least 233 stars; GitHub did not answer for 1. See them.'
  );
  // No 60-second best: no headline borrowed from another length. Each day reads back from now.
  const typing = panel(page, 'monkeytype').locator('.typing-body');
  await expect(typing.locator('p').first()).toHaveText('No 60-second best yet.');
  await expect(typing.locator('dt')).toHaveText(['15 seconds', '120 seconds', '25 words']);
  await expect(typing.locator('dd')).toHaveText([
    '118 wpm, 97%, 10 days ago',
    '99 wpm, 93%, 2 days ago',
    '128 wpm, 97%, today',
  ]);
  await expect(typing.locator('dd time').first()).toHaveAttribute('title', '16 Oct 2026');
  for (const source of sources) {
    await expect(freshness(page, source)).toHaveText(/^Updated (1|10) minutes? ago$/);
  }
});

// A source that never succeeded, a failed request, an answer for another source, one that is
// not JSON, one from the future and one dated on a day the calendar does not have: the build's
// snapshot stays, labelled with its own age, which is past listening's 15 minutes.
for (const [name, answer] of [
  [
    'never succeeded',
    json({ source: 'listening', version: 1, fetchedAt: null, stale: true, data: null }),
  ],
  ['a server error', { status: 500, body: '{"error":"internal_error"}' }],
  ['another source', envelope('shipping')],
  ['not JSON', { status: 200, contentType: 'application/json', body: '{"source":' }],
  ['from the future', envelope('listening', { fetchedAt: '2026-10-26T14:00:00Z' })],
  ['on 31 September', envelope('listening', { fetchedAt: '2026-09-31T11:59:00Z' })],
  // Newer than the build's, but not current: only a fresh answer replaces what is shown.
  [
    'flagged stale by signals',
    envelope('listening', {
      stale: true,
      data: { ...snapshotFixtures.listening.ok, nowPlaying: null, recent: [] },
    }),
  ],
  ['older than the threshold', envelope('listening', { fetchedAt: '2026-10-26T11:30:00Z' })],
] as const) {
  test(`keeps the build's snapshot on an answer: ${name}`, async ({ page }) => {
    const asked = await visit(page, noon, { listening: answer });
    await expect.poll(() => asked.length).toBe(1);
    await expect(freshness(page, 'listening')).toHaveText(
      'May be out of date: updated 3 hours ago'
    );
    await expect(freshness(page, 'listening').locator('time')).toHaveAttribute(
      'datetime',
      '2026-10-26T09:00:00Z'
    );
    await expect(page.locator('.now-playing')).toHaveText(
      'Last played Friendships and Love by Rocketship, 3 hours ago'
    );
  });
}

// Catches a stale answer passed off as current, and a good answer dropped when a later request
// fails: it stays, and its label ages until it is out of date.
test('a good answer stays through failures and ages honestly', async ({ page }) => {
  let fail = false;
  await visit(page, noon, {
    listening: (route) =>
      fail ? route.fulfill({ status: 502, body: '' }) : route.fulfill(envelope('listening')),
  });
  await expect(page.locator('.now-playing')).toHaveText(/^Now playing/);
  await expect(freshness(page, 'listening')).toHaveText('Updated 1 minute ago');
  fail = true;
  await page.clock.runFor(60_000);
  await expect(page.locator('.now-playing')).toHaveText(
    'Last played Friendships and Love by Rocketship, 2 minutes ago'
  );
  await expect(freshness(page, 'listening')).toHaveText('Updated 2 minutes ago');
  await page.clock.runFor(14 * 60_000);
  await expect(freshness(page, 'listening')).toHaveText(
    'May be out of date: updated 16 minutes ago'
  );
  await expect(panel(page, 'listening').locator('dd').first()).toHaveText('124');
});

// Catches a stale answer wiping out what the build showed: a day later, signals still serves
// yesterday's snapshot, flagged stale and empty. The build's list stays, labelled with its age.
test('a stale answer keeps what is shown, ageing', async ({ page }) => {
  await visit(page, '2026-10-27T12:00:00Z', {
    shipping: envelope('shipping', { stale: true, data: { events: [], starHistory: [] } }),
  });
  await expect(freshness(page, 'shipping')).toHaveText('May be out of date: updated yesterday');
  await expect(freshness(page, 'shipping').locator('time')).toHaveAttribute(
    'datetime',
    '2026-10-26T09:00:00Z'
  );
  await expect(panel(page, 'shipping').locator('.shipping li')).toHaveCount(15);
});

// Catches polling a hidden tab, and a tab restored from the back/forward cache showing what it
// showed hours ago without asking again.
test('a tab hidden for hours asks again when it is shown', async ({ page }) => {
  await page.addInitScript(() => {
    let hidden = false;
    Object.defineProperty(document, 'hidden', { get: () => hidden });
    Object.defineProperty(document, 'visibilityState', {
      get: () => (hidden ? 'hidden' : 'visible'),
    });
    window.setHidden = (value: boolean) => {
      hidden = value;
    };
  });
  const asked = await visit(page, noon, { shipping: envelope('shipping') });
  await expect(freshness(page, 'shipping')).toHaveText('Updated 1 minute ago');
  await page.evaluate(() => window.setHidden(true));
  await page.clock.fastForward(3 * 60 * 60_000);
  expect(asked).toHaveLength(1);
  await page.evaluate(() => {
    window.setHidden(false);
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  await expect.poll(() => asked.length).toBe(2);
  await expect(freshness(page, 'shipping')).toHaveText(/^Updated 3 hours ago/);
});

declare global {
  interface Window {
    setHidden(hidden: boolean): void;
  }
}

test('each panel asks at its own pace', async ({ page }) => {
  const asked = await visit(page, noon, {
    listening: envelope('listening'),
    shipping: envelope('shipping'),
    projects: envelope('projects'),
    monkeytype: envelope('monkeytype'),
  });
  const counts = () =>
    sources.map((source) => asked.filter((url) => url.endsWith(`/${source}`)).length);
  await expect.poll(() => asked.length).toBe(4);
  await page.clock.runFor(14 * 60_000);
  expect(counts()).toEqual([15, 1, 1, 1]);
  await page.clock.runFor(60_000);
  await expect.poll(counts).toEqual([16, 2, 2, 1]);
  // Typing hourly (ADR 0033).
  await page.clock.runFor(45 * 60_000);
  await expect.poll(counts).toEqual([61, 5, 5, 2]);
});

// The exact time is the reader's own, in their locale; the text counts back from now.
test('times read relative to now, exact in the title', async ({ browser }) => {
  const page = await newPage(browser, { timezoneId: 'Asia/Tokyo', locale: 'en-GB' });
  await page.clock.install({ time: noon });
  await page.goto('/stats');
  const time = page.locator('.now-playing time');
  await expect(time).toHaveText('3 hours ago');
  await expect(time).toHaveAttribute('title', '26 Oct 2026, 18:00');
  await page.context().close();
});

const newPage = async (browser: Browser, options: Parameters<Browser['newContext']>[0]) =>
  (await browser.newContext(options)).newPage();

// Fixtures mode builds the public Previews: nobody should take its numbers for live ones.
test('fixtures mode labels every panel as sample data and asks for nothing', async ({
  page,
  baseURL,
}) => {
  const elsewhere: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith(baseURL ?? '')) elsewhere.push(request.url());
  });
  await page.goto('/stats');
  await expect(page.locator('.sample-banner')).toContainText('Sample data');
  for (const source of sources) {
    await expect(panel(page, source).locator('.sample')).toHaveText('Sample data, not live');
  }
  await page.waitForLoadState('networkidle');
  expect(elsewhere).toEqual([]);
});

test('without JavaScript the panels show the build, timed in Rabat', async ({ browser }) => {
  const page = await newPage(browser, { javaScriptEnabled: false });
  await page.goto('/stats');
  await expect(page.locator('.now-playing')).toHaveText(
    'Last played Friendships and Love by Rocketship, 26 Oct, 09:00'
  );
  await expect(page.locator('.now-playing time')).toHaveAttribute('title', 'Rabat time');
  await expect(page.locator('.shipping time').first()).toHaveText(/^\d+ \w{3}, \d\d:\d\d$/);
  // The day each best was set, as a date.
  await expect(panel(page, 'monkeytype').locator('strong')).toHaveText('104 wpm');
  await expect(panel(page, 'monkeytype').locator('time').first()).toHaveText('14 Jan 2021');
  await page.context().close();
});
