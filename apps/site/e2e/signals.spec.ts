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

// The build cannot know whether the track still plays: it says when it was last seen.
test('now playing shows the build-time value as last played, with its age', async ({ page }) => {
  await page.clock.install({ time: '2026-10-26T12:00:00Z' });
  await page.goto('/');
  const line = page.locator('.now-playing');
  await expect(line).toHaveText('Last played Friendships and Love by Rocketship, 3 hours ago');
  // A track change rewrites the sentence's nodes; it must be announced whole. The time ticks
  // every minute outside the announced part.
  await expect(line.locator('span')).toHaveAttribute('aria-live', 'polite');
  await expect(line.locator('span')).toHaveAttribute('aria-atomic', 'true');
  await expect(line.locator('span time')).toHaveCount(0);
  await expect(line.locator('time')).toHaveAttribute('datetime', '2026-10-26T09:00:00Z');
});

// The e2e build runs in fixtures mode, where the page never fetches. Each test below turns the
// live fetch on by giving the listening panel the API endpoint, as an api mode build does, then
// answers the API itself. The page's clock starts a minute after the answers' fetchedAt, and
// only the test moves it on.
const now = '2026-10-26T10:31:00Z';

async function goLive(page: Page, answer: Parameters<Page['route']>[1]) {
  await page.clock.install({ time: now });
  await page.route('**/', async (route) => {
    const response = await route.fetch();
    const html = (await response.text()).replace(
      'data-live="listening"',
      `data-live="listening" data-live-src="${api}"`
    );
    await route.fulfill({ response, body: html });
  });
  await page.route(api, answer);
  await page.goto('/');
}

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
  ) as Record<string, unknown>;

const envelope = (stale: boolean, data: unknown, fetchedAt = '2026-10-26T10:30:00Z') => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ source: 'listening', version: 1, fetchedAt, stale, data }),
});

const listening = (stale: boolean, nowPlaying: unknown, recent: unknown[] = []) =>
  envelope(stale, { ...snapshot('ok'), nowPlaying, recent });

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
  await expect(page.locator('.now-playing')).toHaveText('Now playing Which Will by Nick Drake');
  await expect(page.locator('.now-playing a')).toHaveAttribute(
    'href',
    'https://www.last.fm/music/Nick+Drake/_/Which+Will'
  );
});

test('now playing keeps the build-time value when the API fails', async ({ page }) => {
  let asked = false;
  await goLive(page, (route) => {
    asked = true;
    return route.fulfill({ status: 500, body: '{"error":"internal_error"}' });
  });
  await expect.poll(() => asked).toBe(true);
  await expect(page.locator('.now-playing')).toHaveText(
    'Last played Friendships and Love by Rocketship, 1 hour ago'
  );
});

test('now playing does not claim a stale answer is live', async ({ page }) => {
  await goLive(page, (route) => route.fulfill(listening(true, null)));
  // Not current, so it does not replace the build's track.
  await expect(page.locator('.now-playing')).toHaveText(
    'Last played Friendships and Love by Rocketship, 1 hour ago'
  );
});

// Catches a link to anywhere but Last.fm: the contract allows only Last.fm pages, so an answer
// with another link is not shown at all.
test('now playing ignores an answer that links off Last.fm', async ({ page }) => {
  let asked = false;
  await goLive(page, (route) => {
    asked = true;
    return route.fulfill(
      listening(false, { track: 'Bad', artist: 'Link', album: null, url: 'javascript:alert(1)' })
    );
  });
  await expect.poll(() => asked).toBe(true);
  await expect(page.locator('.now-playing')).toHaveText(/^Last played Friendships and Love/);
  await expect(page.locator('.now-playing a')).toHaveAttribute(
    'href',
    /^https:\/\/www\.last\.fm\//
  );
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
    text: 'Last played Friendships and Love by Rocketship, 1 hour ago',
    turns: false,
    motion: 'no-preference',
  },
  {
    name: 'rests when nothing is playing',
    stale: false,
    data: 'empty',
    text: 'Nothing playing right now',
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

// A live answer describes now only while it is fresh (15 minutes after its fetchedAt,
// staleAfterSeconds.listening) and while the latest request brought a usable answer. Catches a
// record that keeps turning when the API starts failing, hangs, or the tab sleeps, and one that
// trusts any timestamp it is sent (ADR 0027).
const playing = (fetchedAt = '2026-10-26T10:30:00Z', track = 'Which Will') =>
  envelope(
    false,
    { ...snapshot('ok'), nowPlaying: { track, artist: 'Nick Drake', album: null, url: null } },
    fetchedAt
  );

const expectLive = async (page: Page, track = 'Which Will') => {
  await expect(page.locator('.now-playing')).toHaveText(`Now playing ${track} by Nick Drake`);
  expect(await disc(page)).toBe('spin');
};

const expectRested = async (page: Page, when: string, track = 'Which Will') => {
  await expect(page.locator('.now-playing')).toHaveText(
    `Last played ${track} by Nick Drake, ${when}`
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
  await expectRested(page, '2 minutes ago');
});

test('the record turns again when the API answers after a failure', async ({ page }) => {
  let fail = false;
  await goLive(page, (route) =>
    fail ? route.fulfill({ status: 503, body: '' }) : route.fulfill(playing('2026-10-26T10:32:00Z'))
  );
  await expectLive(page);
  fail = true;
  await page.clock.runFor(60_000);
  await expectRested(page, 'just now');
  fail = false;
  await page.clock.runFor(60_000);
  await expectLive(page);
});

// Catches an ignored answer restarting the record: after a failure ends it, an answer older
// than the one shown, stale and empty, must not bring back "Now playing".
test('the record stays stopped on an older answer after a failure', async ({ page }) => {
  let requests = 0;
  await goLive(page, (route) => {
    requests += 1;
    if (requests === 1) return route.fulfill(playing());
    if (requests === 2) return route.fulfill({ status: 503, body: '' });
    return route.fulfill(
      envelope(true, { ...snapshot('ok'), nowPlaying: null, recent: [] }, '2000-01-01T00:00:00Z')
    );
  });
  await expectLive(page);
  await page.clock.runFor(60_000);
  await expectRested(page, '2 minutes ago');
  await page.clock.runFor(60_000);
  await expect.poll(() => requests).toBe(3);
  await expectRested(page, '3 minutes ago');
});

// Catches an empty answer that stays an undated claim: after a week of failures, the line
// says when Last.fm was last checked.
test('nothing played says when it was checked once it no longer describes now', async ({
  page,
}) => {
  let requests = 0;
  await goLive(page, (route) =>
    ++requests === 1
      ? route.fulfill(envelope(false, snapshot('empty')))
      : route.fulfill({ status: 503, body: '' })
  );
  await expect(page.locator('.now-playing')).toHaveText('Nothing playing right now');
  await page.clock.fastForward(7 * 24 * 60 * 60_000);
  await page.clock.runFor(60_000);
  await expect(page.locator('.now-playing')).toHaveText('Nothing played lately, checked 26 Oct');
  await expect(page.locator('.now-playing time')).toHaveAttribute(
    'datetime',
    '2026-10-26T10:30:00Z'
  );
});

// One request at a time, given up after 5 s: a refresh that hangs counts as a failure, and the
// next minute asks again.
test('the record stops when a refresh hangs past its deadline', async ({ page }) => {
  let requests = 0;
  await goLive(page, async (route) => {
    // Every later request is left unanswered.
    if (++requests === 1) await route.fulfill(playing());
  });
  await expectLive(page);
  await page.clock.runFor(60_000);
  await expect.poll(() => requests).toBe(2);
  // Coming back to the tab while it waits asks for nothing more.
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expectLive(page);
  expect(requests).toBe(2);
  await page.clock.runFor(5_000);
  await expect(page.locator('.now-playing')).toHaveText(
    'Last played Which Will by Nick Drake, 2 minutes ago',
    { timeout: 10_000 }
  );
  await page.clock.runFor(60_000);
  await expect.poll(() => requests).toBe(3);
});

test('the record has stopped when a tab hidden past the limit comes back', async ({ page }) => {
  await page.addInitScript(() => {
    let hidden = false;
    Object.defineProperty(document, 'visibilityState', {
      get: () => (hidden ? 'hidden' : 'visible'),
    });
    Object.defineProperty(document, 'hidden', { get: () => hidden });
    window.setHidden = (value: boolean) => {
      hidden = value;
      document.dispatchEvent(new Event('visibilitychange'));
    };
  });
  let requests = 0;
  // The API keeps sending the same answer, as a cache that stopped updating would.
  await goLive(page, (route) => {
    requests += 1;
    return route.fulfill(playing());
  });
  await expectLive(page);
  await page.evaluate(() => window.setHidden(true));
  await page.clock.fastForward(16 * 60_000);
  // A hidden tab asks for nothing.
  expect(requests).toBe(1);
  await page.evaluate(() => window.setHidden(false));
  await expectRested(page, '17 minutes ago');
  await expect.poll(() => requests).toBe(2);
});

declare global {
  interface Window {
    setHidden(hidden: boolean): void;
  }
}

// The second answer names another track, so the test sees when it has been read.
for (const { fetchedAt, live, shown } of [
  // A server clock a minute ahead of the visitor's is still believable.
  { fetchedAt: '2026-10-26T10:32:00Z', live: true, shown: 'Pink Moon' },
  // An answer older than the one shown (another cache, say) keeps the track but says nothing
  // about now: the latest request did not bring a current answer.
  { fetchedAt: '2000-01-01T00:00:00Z', live: false, shown: 'Which Will' },
  // An answer from the future, with no readable time, or on a day the calendar does not have
  // is ignored, and no longer says anything about now.
  { fetchedAt: '2099-01-01T00:00:00Z', live: false, shown: 'Which Will' },
  { fetchedAt: 'not-a-time', live: false, shown: 'Which Will' },
  { fetchedAt: '2026-09-31T10:30:00Z', live: false, shown: 'Which Will' },
]) {
  test(`the record ${live ? 'turns' : 'stops'} on an answer fetched at ${fetchedAt}`, async ({
    page,
  }) => {
    let requests = 0;
    await goLive(page, (route) =>
      route.fulfill(++requests === 1 ? playing() : playing(fetchedAt, 'Pink Moon'))
    );
    await expectLive(page);
    await page.clock.runFor(60_000);
    if (live) await expectLive(page, shown);
    else await expectRested(page, '2 minutes ago', shown);
  });
}
