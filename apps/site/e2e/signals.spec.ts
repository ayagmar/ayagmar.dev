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
// the live fetch on by giving the island the API endpoint, then answers the API itself.
async function goLive(page: Page, answer: Parameters<Page['route']>[1]) {
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
    fetchedAt: '2026-10-26T09:00:00Z',
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
  await expect(page.locator('.now-playing')).toHaveText('Nothing playing as of 26 Oct, 09:00 UTC.');
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
