import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';

const api = 'https://api.ayagmar.dev/v1/listening';

test('pages with source data load nothing from other origins in fixtures mode', async ({
  page,
  baseURL,
}) => {
  const elsewhere: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith(baseURL ?? '')) elsewhere.push(request.url());
  });
  for (const path of ['/', '/stats', '/projects']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
  }
  await expect(page.getByRole('link', { name: 'llm-usage-metrics' })).toBeVisible();
  expect(elsewhere).toEqual([]);
});

test('now playing shows the build-time value, labelled with its time', async ({ page }) => {
  await page.goto('/');
  // A track change rewrites single text nodes; the whole sentence must be announced.
  await expect(page.locator('.now-playing')).toHaveAttribute('aria-live', 'polite');
  await expect(page.locator('.now-playing')).toHaveAttribute('aria-atomic', 'true');
  await expect(page.locator('.now-playing')).toHaveText(
    /^Playing Friendships and Love by Rocketship as of \d+ \w{3}, \d\d:\d\d UTC\.$/
  );
});

// The e2e build runs in fixtures mode, where the island never fetches. Each test below turns
// the live fetch on by giving the island the API endpoint, then answers the API itself. The
// page's clock starts a minute after the answers' fetchedAt, and only the test moves it on.
const now = '2026-10-26T10:31:00Z';

async function goLive(page: Page, answer: Parameters<Page['route']>[1]) {
  await page.clock.install({ time: now });
  await page.route('**/', async (route) => {
    const response = await route.fetch();
    const html = (await response.text()).replace(
      '&quot;endpoint&quot;:[0,null]',
      `&quot;endpoint&quot;:[0,&quot;${api}&quot;]`
    );
    await route.fulfill({ response, body: html });
  });
  await page.route(api, answer);
  await page.goto('/');
  // The island hydrates when it scrolls into view (client:visible).
  await page.locator('.now-playing').scrollIntoViewIfNeeded();
}

const listening = (stale: boolean, nowPlaying: unknown) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({
    source: 'listening',
    version: 1,
    fetchedAt: '2026-10-26T10:30:00Z',
    stale,
    data: { nowPlaying, recent: [], topArtists: null, scrobbles: { thisWeek: 1, lastWeek: 2 } },
  }),
});

test('now playing updates from the read API', async ({ page }) => {
  await goLive(page, (route) =>
    route.fulfill(
      listening(false, {
        track: 'Which Will',
        artist: 'Nick Drake',
        album: null,
        url: 'https://www.last.fm/music/Nick+Drake/_/Which+Will',
      })
    )
  );
  await expect(page.locator('.now-playing')).toHaveText('Now playing Which Will by Nick Drake.');
});

test('now playing keeps the build-time value when the API fails', async ({ page }) => {
  let asked = false;
  await goLive(page, (route) => {
    asked = true;
    return route.fulfill({ status: 500, body: '{"error":"internal_error"}' });
  });
  await expect.poll(() => asked).toBe(true);
  await expect(page.locator('.now-playing')).toHaveText(
    /^Playing Friendships and Love by Rocketship as of/
  );
});

test('now playing does not claim a stale answer is live', async ({ page }) => {
  await goLive(page, (route) => route.fulfill(listening(true, null)));
  await expect(page.locator('.now-playing')).toHaveText('Nothing playing as of 26 Oct, 10:30 UTC.');
});

test('now playing links only to Last.fm', async ({ page }) => {
  await goLive(page, (route) =>
    route.fulfill(
      listening(false, { track: 'Bad', artist: 'Link', album: null, url: 'javascript:alert(1)' })
    )
  );
  await expect(page.locator('.now-playing')).toHaveText('Now playing Bad by Link.');
  await expect(page.locator('.now-playing a')).toHaveCount(0);
});

// The shared listening fixtures (packages/contracts/fixtures/listening/snapshot).
const snapshot = (name: 'ok' | 'empty') =>
  JSON.parse(
    readFileSync(
      join(
        import.meta.dirname,
        '../../../packages/contracts/fixtures/listening/snapshot',
        `${name}.json`
      ),
      'utf8'
    )
  ) as unknown;

const envelope = (stale: boolean, data: unknown) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({
    source: 'listening',
    version: 1,
    fetchedAt: '2026-10-26T10:30:00Z',
    stale,
    data,
  }),
});

const disc = (page: Page) =>
  page.locator('.disc').evaluate((element) => getComputedStyle(element).animationName);

// Catches a record that turns for a build-time, stale or empty answer, or for people who asked
// for less motion (ADR 0027).
test('the record rests on the build-time value', async ({ page }) => {
  await page.goto('/');
  expect(await disc(page)).toBe('none');
});

for (const { name, stale, data, text, turns, motion } of [
  {
    name: 'turns while a track is playing now',
    stale: false,
    data: 'ok',
    text: /^Now playing/,
    turns: true,
    motion: 'no-preference',
  },
  {
    name: 'rests on a stale answer',
    stale: true,
    data: 'ok',
    text: /as of 26 Oct, 10:30 UTC\.$/,
    turns: false,
    motion: 'no-preference',
  },
  {
    name: 'rests when nothing is playing',
    stale: false,
    data: 'empty',
    text: 'Nothing playing right now.',
    turns: false,
    motion: 'no-preference',
  },
  {
    name: 'rests with reduced motion',
    stale: false,
    data: 'ok',
    text: /^Now playing/,
    turns: false,
    motion: 'reduce',
  },
] as const) {
  test(`the record ${name}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: motion });
    await goLive(page, (route) => route.fulfill(envelope(stale, snapshot(data))));
    await expect(page.locator('.now-playing')).toHaveText(text);
    expect(await disc(page)).toBe(turns ? 'spin' : 'none');
  });
}

// A live answer stops being live 15 minutes after its fetchedAt (staleAfterSeconds.listening),
// whatever happens to later requests. Catches a record that keeps turning when the API starts
// failing, hangs, or the tab sleeps, and one that trusts any timestamp it is sent (ADR 0027).
const playing = (fetchedAt = '2026-10-26T10:30:00Z', track = 'Which Will') => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({
    source: 'listening',
    version: 1,
    fetchedAt,
    stale: false,
    data: { nowPlaying: { track, artist: 'Nick Drake', album: null, url: null } },
  }),
});

const expectLive = async (page: Page, track = 'Which Will') => {
  await expect(page.locator('.now-playing')).toHaveText(`Now playing ${track} by Nick Drake.`);
  expect(await disc(page)).toBe('spin');
};

const expectRested = async (page: Page, shown = 'Which Will as of 26 Oct, 10:30 UTC') => {
  const [track, asOf] = shown.split(' as of ');
  await expect(page.locator('.now-playing')).toHaveText(
    `Playing ${track} by Nick Drake as of ${asOf}.`
  );
  expect(await disc(page)).toBe('none');
};

test('the record stops when a later refresh fails', async ({ page }) => {
  let fail = false;
  await goLive(page, (route) =>
    fail
      ? route.fulfill({ status: 500, body: '{"error":"internal_error"}' })
      : route.fulfill(playing())
  );
  await expectLive(page);
  fail = true;
  await page.clock.runFor(60_000);
  await expectRested(page);
});

test('the record stops at the freshness limit while refreshes hang', async ({ page }) => {
  let answered = false;
  await goLive(page, async (route) => {
    // Every later request is left unanswered.
    if (answered) return;
    answered = true;
    await route.fulfill(playing());
  });
  await expectLive(page);
  await page.clock.runFor(13 * 60_000);
  await expectLive(page);
  await page.clock.runFor(2 * 60_000);
  await expectRested(page);
});

test('the record has stopped when a tab hidden past the limit comes back', async ({ page }) => {
  await page.addInitScript(() => {
    let hidden = false;
    Object.defineProperty(document, 'visibilityState', {
      get: () => (hidden ? 'hidden' : 'visible'),
    });
    window.setHidden = (value: boolean) => {
      hidden = value;
      document.dispatchEvent(new Event('visibilitychange'));
    };
  });
  // The API keeps sending the same answer, as a cache that stopped updating would.
  await goLive(page, (route) => route.fulfill(playing()));
  await expectLive(page);
  await page.evaluate(() => window.setHidden(true));
  await page.clock.fastForward(16 * 60_000);
  await page.evaluate(() => window.setHidden(false));
  await expectRested(page);
});

declare global {
  interface Window {
    setHidden(hidden: boolean): void;
  }
}

// The second answer names another track, so the test sees when it has been read.
for (const { fetchedAt, live, shown } of [
  // A server clock a minute ahead of the visitor's is still believable.
  { fetchedAt: '2026-10-26T10:32:00Z', live: true, shown: '' },
  // An old answer is shown with its time, never as now.
  { fetchedAt: '2000-01-01T00:00:00Z', live: false, shown: 'Pink Moon as of 1 Jan, 00:00 UTC' },
  // An answer from the future or with no readable time is ignored.
  { fetchedAt: '2099-01-01T00:00:00Z', live: false, shown: undefined },
  { fetchedAt: 'not-a-time', live: false, shown: undefined },
]) {
  test(`the record ${live ? 'keeps turning' : 'stops'} on an answer fetched at ${fetchedAt}`, async ({
    page,
  }) => {
    let requests = 0;
    await goLive(page, (route) =>
      route.fulfill(++requests === 1 ? playing() : playing(fetchedAt, 'Pink Moon'))
    );
    await expectLive(page);
    await page.clock.runFor(60_000);
    if (live) await expectLive(page, 'Pink Moon');
    else await expectRested(page, shown);
  });
}
