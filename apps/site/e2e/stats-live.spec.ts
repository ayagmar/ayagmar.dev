// /stats's listening, shipping, projects, typing and LLM usage panels, kept current by the browser (ADR 0015). The
// e2e build runs in fixtures mode, where the page asks signals for nothing. Each test below
// turns a panel live as an api mode build would (its endpoint, and a freshness line where the
// sample tape is), answers the API itself, and fixes the browser's clock.
import { snapshotFixtures } from '@min7/contracts/fixtures';
import type { Browser, Locator, Page, Route } from '@playwright/test';
import { expect, test } from './fixtures.ts';

const api = 'https://api.ayagmar.dev/v1';
const sources = ['listening', 'shipping', 'projects', 'monkeytype', 'llm-usage'] as const;
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
  'llm-usage': '.llm-usage-body',
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
  ).toHaveText(['3 hours ago Half Right by Heatmiser']);
  await expect(panel(page, 'shipping').locator('.shipping li')).toHaveText([
    '10 minutes ago runnerd merged #7: Live stats',
  ]);
  await expect(
    panel(page, 'shipping').getByRole('heading', { name: 'Stars on other repositories' })
  ).toHaveCount(0);
  await expect(panel(page, 'projects').locator('.projects-body')).toHaveText(
    /7 featured projects, at least 233 stars; GitHub did not answer for 1\. All projects\.$/
  );
  // No 60-second best: no headline borrowed from another length. Each day reads back from now.
  const typing = panel(page, 'monkeytype').locator('.typing-body');
  await expect(typing.locator('p').first()).toHaveText('No 60-second best yet.');
  await expect(typing.locator('dt')).toHaveText(['15 seconds', '120 seconds', '25 words']);
  await expect(typing.locator('dd')).toHaveText([
    '118 wpm 97% accuracy 10 days ago',
    '99 wpm 93% accuracy 2 days ago',
    '128 wpm 97% accuracy today',
  ]);
  await expect(typing.locator('dd time').first()).toHaveAttribute('title', '16 Oct 2026');
  for (const source of ['listening', 'shipping', 'projects', 'monkeytype'] as const) {
    await expect(freshness(page, source)).toHaveText(/^Updated (1|10) minutes? ago$/);
  }
});

/** The links in each of the listening panel's `selector`, by href. */
const hrefs = (page: Page, selector: string) =>
  panel(page, 'listening')
    .locator(selector)
    .evaluateAll((items) =>
      items.map((item) => [...item.querySelectorAll('a')].map((a) => a.getAttribute('href')))
    );

// Catches a track or artist that is not a link, a link off Last.fm, and a link built from a
// name Last.fm would not find: signals' own link when it sent one, else one built from the
// names, on the build's page and on a live answer alike.
test('links each track and artist to its Last.fm page', async ({ page }) => {
  const { ok } = snapshotFixtures.listening;
  const [first] = ok.recent;
  await page.clock.install({ time: noon });
  await page.goto('/stats');
  expect((await hrefs(page, '.listening-body ol >> nth=0 >> li')).at(0)).toEqual([
    'https://www.last.fm/music/Heatmiser/_/Half+Right',
    'https://www.last.fm/music/Heatmiser',
  ]);
  await page.unrouteAll();

  const fresh = await page.context().newPage();
  await visit(fresh, noon, {
    listening: envelope('listening', {
      data: {
        ...ok,
        nowPlaying: null,
        recent: [{ ...first, track: 'Why Bother?', artist: 'AC/DC', url: null }],
        topArtists: [
          { artist: 'Florence + the Machine', plays: 3, url: null },
          { artist: 'Simon & Garfunkel', plays: 2, url: 'https://www.last.fm/music/S&G' },
        ],
      },
    }),
  });
  await expect
    .poll(() => hrefs(fresh, '.now-playing'))
    .toEqual([
      ['https://www.last.fm/music/AC%2FDC/_/Why+Bother%3F', 'https://www.last.fm/music/AC%2FDC'],
    ]);
  expect(await hrefs(fresh, '.listening-body ol >> nth=0 >> li')).toEqual([
    ['https://www.last.fm/music/AC%2FDC/_/Why+Bother%3F', 'https://www.last.fm/music/AC%2FDC'],
  ]);
  expect(await hrefs(fresh, '.listening-body ol >> nth=1 >> li')).toEqual([
    ['https://www.last.fm/music/Florence+%252B+the+Machine'],
    ['https://www.last.fm/music/S&G'],
  ]);
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
      'Last played Friendships and Love by Rocketship · 3 hours ago'
    );
  });
}

// Catches modes sent as arrays read as "no bests": the contract rejects the answer, so the
// build's bests stay, labelled with their own age.
test('an answer with modes as arrays keeps the bests shown', async ({ page }) => {
  const asked = await visit(page, noon, {
    monkeytype: envelope('monkeytype', {
      data: { time: Array(121).fill(null), words: Array(101).fill(null) },
    }),
  });
  await expect.poll(() => asked.length).toBe(1);
  await expect(freshness(page, 'monkeytype')).toHaveText('Updated 3 hours ago');
  await expect(panel(page, 'monkeytype').locator('strong')).toHaveText('104 wpm');
});

// Catches the page passing on fields the contract does not name: fake identifiers around the
// answer, around the bests and in one, which the reader accepts as extra keys, reach no HTML.
test('identifiers in a typing answer never reach the page', async ({ page }) => {
  const fake = {
    uid: 'fake-uid-0000000000000000000000',
    name: 'fake-monkeytype-name',
    email: 'fake@example.invalid',
    apeKeyId: 'fake-ape-key-id-000000',
  };
  const { ok } = snapshotFixtures.monkeytype;
  await visit(page, noon, {
    monkeytype: json({
      ...fake,
      source: 'monkeytype',
      version: 1,
      fetchedAt: '2026-10-26T11:59:00Z',
      stale: false,
      data: { ...ok, ...fake, time: { ...ok.time, ...fake, 60: { ...ok.time[60], ...fake } } },
    }),
  });
  // Shown: the answer replaced the build's.
  await expect(freshness(page, 'monkeytype')).toHaveText('Updated 1 minute ago');
  await expect(panel(page, 'monkeytype').locator('strong')).toHaveText('104 wpm');
  const html = await page.content();
  for (const value of Object.values(fake)) expect(html).not.toContain(value);
});

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
    'Last played Friendships and Love by Rocketship · 2 minutes ago'
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

// Catches a panel rebuilt with the snapshot it already shows: a failed request, or the answer
// ageing, closed the fold the reader had opened.
test('a fold the reader opened stays open while the snapshot is the same', async ({ page }) => {
  let fail = false;
  await visit(page, noon, {
    shipping: (route) =>
      fail ? route.fulfill({ status: 502, body: '' }) : route.fulfill(envelope('shipping')),
  });
  await expect(freshness(page, 'shipping')).toHaveText('Updated 1 minute ago');
  const fold = panel(page, 'shipping').locator('details.more').first();
  await fold.locator('summary').click();
  await expect(fold).toHaveAttribute('open');
  fail = true;
  await page.clock.runFor(5 * 60_000);
  await expect(freshness(page, 'shipping')).toHaveText('Updated 6 minutes ago');
  await expect(fold).toHaveAttribute('open');
});

/** Lets the test hide and show the page with `window.setHidden`. */
const hideable = (page: Page) =>
  page.addInitScript(() => {
    let hidden = false;
    Object.defineProperty(document, 'hidden', { get: () => hidden });
    Object.defineProperty(document, 'visibilityState', {
      get: () => (hidden ? 'hidden' : 'visible'),
    });
    window.setHidden = (value: boolean) => {
      hidden = value;
    };
  });

// Catches polling a hidden tab, and a tab restored from the back/forward cache showing what it
// showed hours ago without asking again.
test('a tab hidden for hours asks again when it is shown', async ({ page }) => {
  await hideable(page);
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

// Catches a tab that comes back showing what it had when it hid until the panel's next turn
// (shipping asks every 5 minutes), and one that asks again on every return.
test('a tab that comes back asks at once if its last request is a minute old', async ({ page }) => {
  await hideable(page);
  const asked = await visit(page, noon, { shipping: envelope('shipping') });
  await expect(freshness(page, 'shipping')).toHaveText('Updated 1 minute ago');
  const away = async (ms: number) => {
    await page.evaluate(() => window.setHidden(true));
    await page.clock.fastForward(ms);
    await page.evaluate(() => {
      window.setHidden(false);
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
    });
  };
  await away(30_000);
  await page.waitForTimeout(300);
  expect(asked).toHaveLength(1);
  await away(60_000);
  await expect.poll(() => asked.length).toBe(2);
  await page.waitForTimeout(300);
  expect(asked).toHaveLength(2);
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
    'llm-usage': envelope('llm-usage'),
  });
  let answered = 0;
  page.on('requestfinished', (request) => {
    if (request.url().startsWith(api)) answered++;
  });
  const counts = () =>
    sources.map((source) => asked.filter((url) => url.endsWith(`/${source}`)).length);
  // Listening every minute, shipping every 5, projects every 30, typing and LLM usage every 15
  // (ADR 0015), in the order of `sources`: asked on load, then at each multiple of its pace.
  const paces = [1, 5, 30, 15, 15];
  await expect.poll(() => asked.length).toBe(5);
  // A minute at a time, each minute's answers in before the next. The clock fires its timers in
  // the page back to back, so a 15-minute jump can reach the next minute while an answer is still
  // on its way, and the panel rightly skips a minute while its request is pending.
  for (let minute = 1; minute <= 30; minute++) {
    await expect.poll(() => answered).toBe(asked.length);
    await page.clock.runFor(60_000);
    await expect.poll(counts).toEqual(paces.map((pace) => Math.floor(minute / pace) + 1));
  }
});

// Catches a best's day that turns over only when a new answer is drawn: past the reader's
// midnight, "today" must become "yesterday" on the minute tick and when the tab comes back,
// whether the next answer is the same, a failure or never asked for (the sample).
test.describe('a best set today', () => {
  test.use({ timezoneId: 'UTC' });
  const lastDay = (page: Page) => panel(page, 'monkeytype').locator('dd time').last();
  // The partial snapshot's 25-word best was set on 26 October.
  const same = envelope('monkeytype', {
    fetchedAt: '2026-10-26T23:57:00Z',
    data: snapshotFixtures.monkeytype.partial,
  });

  test('is yesterday an hour later, with the same answer again', async ({ page }) => {
    const asked = await visit(page, '2026-10-26T23:58:00Z', { monkeytype: same });
    await expect(lastDay(page)).toHaveText('today');
    await page.clock.fastForward(60 * 60_000);
    await expect.poll(() => asked.length).toBe(2);
    await expect(lastDay(page)).toHaveText('yesterday');
  });

  test('is yesterday when the tab comes back, the request failing', async ({ page }) => {
    let fail = false;
    const asked = await visit(page, '2026-10-26T23:58:00Z', {
      monkeytype: (route) => route.fulfill(fail ? { status: 502, body: '' } : same),
    });
    await expect(lastDay(page)).toHaveText('today');
    fail = true;
    // No timer fires; the tab's return is the only prompt.
    await page.clock.setSystemTime('2026-10-27T00:59:00Z');
    await page.evaluate(() =>
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
    );
    await expect.poll(() => asked.length).toBe(2);
    await expect(lastDay(page)).toHaveText('yesterday');
  });

  test('is yesterday after midnight in the sample', async ({ page }) => {
    // The sample's 15-second best was set on 15 July 2022.
    await page.clock.install({ time: '2022-07-15T23:58:00Z' });
    await page.goto('/stats');
    const first = panel(page, 'monkeytype').locator('dd time').first();
    await expect(first).toHaveText('today');
    await page.clock.runFor(3 * 60_000);
    await expect(first).toHaveText('yesterday');
  });
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
    'Last played Friendships and Love by Rocketship · 26 Oct, 09:00'
  );
  await expect(page.locator('.now-playing time')).toHaveAttribute('title', 'Rabat time');
  await expect(page.locator('.shipping time').first()).toHaveText(/^\d+ \w{3}, \d\d:\d\d$/);
  // The day each best was set, as a date.
  await expect(panel(page, 'monkeytype').locator('strong')).toHaveText('104 wpm');
  await expect(panel(page, 'monkeytype').locator('time').first()).toHaveText('14 Jan 2021');
  await page.context().close();
});

// Catches folded rows that are dropped instead of folded (event 6 on gone from the page), a fold
// that needs JavaScript to open, and a repository counted in both the shipping and projects
// windows from two sources that can disagree.
test('without JavaScript long lists fold, and a repository has one star count', async ({
  browser,
}) => {
  const page = await newPage(browser, { javaScriptEnabled: false });
  await page.goto('/stats');
  const shipping = panel(page, 'shipping');
  const events = shipping.locator('.shipping li');
  await expect(events).toHaveCount(15);
  await expect(events.filter({ visible: true })).toHaveCount(5);
  const more = shipping.locator('details.more summary').first();
  await expect(more).toHaveText('10 earlier events');
  await more.click();
  await expect(events.filter({ visible: true })).toHaveCount(15);

  const projects = await panel(page, 'projects').locator('.rows a').allTextContents();
  const counted = await shipping.locator('.rows li > span:first-child').allTextContents();
  expect(projects.length).toBeGreaterThan(0);
  expect(counted.length).toBeGreaterThan(0);
  expect(counted.filter((name) => projects.includes(name))).toEqual([]);
  await page.context().close();
});

test.describe('LLM usage', () => {
  const usage = panel as (page: Page, source: 'llm-usage') => Locator;
  const body = (page: Page) => usage(page, 'llm-usage').locator('.llm-usage-body');
  const period = (page: Page) => body(page).locator('.llm-period');

  // Catches the wrong period's number, tokens in the wrong unit, an agent without its share,
  // a heatmap without its text, or a cost on the page.
  test('the build shows the snapshot, without costs', async ({ browser }) => {
    const page = await newPage(browser, { javaScriptEnabled: false });
    await page.goto('/stats');
    const table = body(page).getByRole('table', { name: 'Tokens and estimated agent hours' });
    await expect(table.locator('thead th')).toHaveText([
      'This month 1–26 Oct',
      'Last 7 days 20–26 Oct',
    ]);
    await expect(table.locator('tbody tr').first()).toHaveText('Tokens61.3M16.4M');
    await expect(table.locator('tbody tr').last()).toHaveText('Agent hours144 hours60 hours');
    await expect(body(page).locator('.llm-agents li')).toHaveText([
      'Claude Code39.8M65%',
      'Codex15.3M25%',
      'pi6.2M10%',
    ]);
    await expect(body(page).getByRole('img')).toHaveAttribute(
      'aria-label',
      'Tokens per day from 27 Oct 2025 to 26 Oct 2026: 11 days with use, the busiest 20 Oct 2026 with 3.1M.'
    );
    await expect(usage(page, 'llm-usage')).not.toContainText('$');
    await page.context().close();
  });

  // Catches a live answer that does not replace the build's, or one drawn with old numbers.
  test('a newer answer replaces the build', async ({ page }) => {
    const { ok } = snapshotFixtures['llm-usage'];
    const agents = [
      { agent: 'Claude Code', costUsd: null, totalTokens: 41_000_000_000, tokenShare: 0.958 },
      { agent: 'Codex', costUsd: null, totalTokens: 1_800_000_000, tokenShare: 0.042 },
      { agent: 'goose', costUsd: null, totalTokens: 1_000, tokenShare: 0 },
    ];
    await visit(page, noon, {
      'llm-usage': envelope('llm-usage', {
        data: { ...ok, monthToDate: { ...ok.monthToDate, agents, totalTokens: 42_800_001_000 } },
      }),
    });
    await expect(freshness(page, 'llm-usage')).toHaveText('Updated 1 minute ago');
    await expect(body(page).locator('.llm-agents li')).toHaveText([
      'Claude Code41.0B96%',
      'Codex1.8B4%',
      'goose1.0K<1%',
    ]);
    await expect(body(page).locator('tbody tr').first()).toHaveText('Tokens42.8B16.4M');
  });

  // Catches "this month" left on screen past midnight in Rabat by an open tab: the period goes,
  // the longest streak and the year stay.
  test('hides the period at midnight in Rabat while the tab is open', async ({ page }) => {
    await visit(page, '2026-10-26T23:58:00Z', {
      'llm-usage': envelope('llm-usage', { fetchedAt: '2026-10-26T23:50:00Z' }),
    });
    await expect(freshness(page, 'llm-usage')).toHaveText('Updated 8 minutes ago');
    await expect(period(page)).toBeVisible();
    await page.clock.runFor(3 * 60_000);
    await expect(period(page)).toBeHidden();
    await expect(body(page).getByText('Longest streak: 23 days.')).toBeVisible();
    await expect(body(page).getByRole('img')).toBeVisible();
  });
});
