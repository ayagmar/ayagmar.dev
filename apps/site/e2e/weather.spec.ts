// The weather in the room's window (ADR 0029). The e2e build runs in fixtures mode, where the
// room never asks for weather. Each test below gives the scene the API endpoint, as an `api`
// mode build would, and answers the API itself from the shared weather fixtures.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import type { Page, Route } from '@playwright/test';
import { expect, test } from './fixtures.ts';

const api = 'https://api.ayagmar.dev/v1/weather';
const minute = 60_000;
// Noon in Rabat (+00), and 03:00: day and night skies.
const noon = '2026-10-26T12:00:00Z';
const night = '2026-10-26T03:00:00Z';

type Case = 'ok' | 'partial' | 'clear' | 'fog' | 'rain' | 'snow' | 'storm' | 'unknown-code';

// The shared weather fixtures (packages/contracts/fixtures/weather/snapshot).
const snapshot = (name: Case) =>
  JSON.parse(
    readFileSync(
      join(
        import.meta.dirname,
        '../../../packages/contracts/fixtures/weather/snapshot',
        `${name}.json`
      ),
      'utf8'
    )
  ) as Record<string, unknown>;

/** A `/v1/weather` answer fetched a minute before `at`, for values from ten minutes before. */
const envelope = (
  name: Case,
  at: string,
  { stale = false, observedAgoMs = 10 * minute, data = {} as Record<string, unknown> } = {}
) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({
    source: 'weather',
    version: 1,
    fetchedAt: new Date(Date.parse(at) - minute).toISOString(),
    stale,
    data: {
      ...snapshot(name),
      observedAt: new Date(Date.parse(at) - observedAgoMs).toISOString(),
      ...data,
    },
  }),
});

/** Opens home at `time` with the weather endpoint turned on, answered by `answer`. */
async function visit(page: Page, time: string, answer: (route: Route) => unknown) {
  await page.clock.install({ time });
  await page.route('**/', async (route) => {
    const response = await route.fetch();
    const html = (await response.text()).replace(
      '<div class="scene"',
      `<div class="scene" data-weather-src="${api}"`
    );
    await route.fulfill({ response, body: html });
  });
  await page.route(api, answer);
  await page.goto('/');
  await expect(page.locator('.scene')).toHaveAttribute('data-sky', /.+/);
}

const file = (css: string) => css.match(/\/_astro\/([\w-]+)\./)?.[1] ?? null;

/** What the window shows and says. */
const room = (page: Page) =>
  page.locator('.scene').evaluate((scene) => {
    const layer = scene.querySelector('.room-weather') as Element;
    const style = getComputedStyle(layer);
    const rain = (pseudo: string) => {
      const sheet = getComputedStyle(layer, pseudo);
      return sheet.display === 'none' ? null : sheet.backgroundImage;
    };
    return {
      weather: scene.getAttribute('data-weather'),
      layer: style.backgroundImage,
      mask: style.maskImage,
      rain: [rain('::before'), rain('::after')],
      label: scene.querySelector('.room-window')?.getAttribute('aria-label'),
    };
  });

const shown = async (page: Page) => {
  const { layer, mask, rain, ...rest } = await room(page);
  return { ...rest, layer: file(layer), mask: file(mask), rain: rain.map((r) => r && file(r)) };
};

const daylight = 'Through the window: daylight over Rabat';

// Catches a code shown as the wrong layer or none, words that do not match it, a temperature
// drawn or missing, and an unknown code shown as anything (ADR 0029).
for (const { name, weather, layer, rain, words } of [
  { name: 'clear', weather: 'clear', layer: null, rain: [null, null], words: ', clear sky, 17 °C' },
  {
    name: 'ok',
    weather: 'overcast',
    layer: 'weather-overcast-day',
    rain: [null, null],
    words: ', overcast, 24 °C',
  },
  {
    name: 'partial',
    weather: 'cloudy',
    layer: 'weather-cloudy-day',
    rain: [null, null],
    words: ', partly cloudy',
  },
  {
    name: 'fog',
    weather: 'fog',
    layer: 'weather-fog-day',
    rain: [null, null],
    words: ', fog, 14 °C',
  },
  {
    name: 'rain',
    weather: 'rain',
    layer: 'weather-rain-day',
    rain: ['weather-drops-day', null],
    words: ', moderate rain, 17 °C',
  },
  {
    name: 'snow',
    weather: 'snow',
    layer: 'weather-snow-day',
    rain: [null, null],
    words: ', slight snowfall, 0 °C',
  },
  {
    name: 'storm',
    weather: 'storm',
    layer: 'weather-storm-day',
    rain: ['weather-drops-day', 'weather-drops-day'],
    words: ', thunderstorm, 16 °C',
  },
  { name: 'unknown-code', weather: 'none', layer: null, rain: [null, null], words: '' },
] as const) {
  test(`the window shows the ${name} fixture as ${weather}`, async ({ page }) => {
    await visit(page, noon, (route) => route.fulfill(envelope(name, noon)));
    await expect(page.locator('.scene')).toHaveAttribute('data-weather', weather);
    expect(await shown(page)).toMatchObject({ layer, rain, label: `${daylight}${words}.` });
    // The temperature is only words: nothing in the room's text shows it.
    await expect(page.locator('.room')).not.toContainText('°C');
  });
}

// Catches weather art picked by the page theme or Open-Meteo's is_day instead of Rabat's sky,
// dusk without a layer, and falling rain escaping the view of the window shown (ADR 0029).
test('the art follows the room clock: night at night and at dusk, whatever the theme', async ({
  page,
}) => {
  // The rain fixture says it is day there (is_day: 1); the room's own clock says night.
  await visit(page, night, (route) => route.fulfill(envelope('rain', night)));
  await expect(page.locator('.scene')).toHaveAttribute('data-weather', 'rain');
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme });
    expect(await shown(page)).toMatchObject({
      layer: 'weather-rain-night',
      mask: 'window-night',
      rain: ['weather-drops-night', null],
    });
  }
  await expect(
    page.getByRole('img', { name: /over Rabat, a full moon, moderate rain/ })
  ).toBeVisible();
});

test('at dusk the window shows the night layer over the dusk sky', async ({ page }) => {
  // 17:35 is still day in Rabat; ten minutes on it is dusk, and the weather is still fresh.
  const evening = '2026-10-26T17:35:00Z';
  await visit(page, evening, (route) => route.fulfill(envelope('storm', evening)));
  expect(await shown(page)).toMatchObject({ layer: 'weather-storm-day', mask: 'window-day' });
  await page.clock.runFor(10 * minute);
  await expect(page.locator('.scene')).toHaveAttribute('data-sky', 'dusk');
  expect(await shown(page)).toMatchObject({
    weather: 'storm',
    layer: 'weather-storm-night',
    mask: 'window-dusk',
    label: expect.stringMatching(/^Through the window: dusk over Rabat, a .+ moon, thunderstorm/),
  });
});

const none = async (page: Page) => {
  await expect(page.locator('.scene')).toHaveAttribute('data-weather', 'none');
  expect(await shown(page)).toMatchObject({
    layer: null,
    rain: [null, null],
    label: `${daylight}.`,
  });
};

// Catches a failed, stale or broken answer shown as weather (ADR 0029: no layer, never a
// wrong one).
for (const [name, answer] of [
  [
    'the API fails',
    (route: Route) => route.fulfill({ status: 500, body: '{"error":"internal_error"}' }),
  ],
  ['the network fails', (route: Route) => route.abort()],
  ['the answer is stale', (route: Route) => route.fulfill(envelope('rain', noon, { stale: true }))],
  [
    'the model data is too old',
    (route: Route) => route.fulfill(envelope('rain', noon, { observedAgoMs: 46 * minute })),
  ],
  ['the answer is not JSON', (route: Route) => route.fulfill({ status: 200, body: '<html>' })],
  [
    'the API fails with a weather body',
    (route: Route) => route.fulfill({ ...envelope('rain', noon), status: 500 }),
  ],
  [
    'a value has the wrong type',
    (route: Route) => route.fulfill(envelope('rain', noon, { data: { isDay: 'broken' } })),
  ],
] as const) {
  test(`the window shows no weather when ${name}`, async ({ page }) => {
    let asked = false;
    await visit(page, noon, (route) => {
      asked = true;
      return answer(route);
    });
    await expect.poll(() => asked).toBe(true);
    // Time for a wrong answer to land.
    await page.waitForTimeout(300);
    await none(page);
  });
}

// Catches a broken refresh leaving the last good weather, or its temperature, in the window.
for (const [name, answer] of [
  [
    'is out of range',
    (route: Route) => route.fulfill(envelope('snow', noon, { data: { temperatureC: 1e300 } })),
  ],
  [
    'fails with a weather body',
    (route: Route) => route.fulfill({ ...envelope('snow', noon), status: 503 }),
  ],
  [
    'lacks a value',
    (route: Route) => route.fulfill(envelope('snow', noon, { data: { windSpeedKmh: undefined } })),
  ],
] as const) {
  test(`a refresh that ${name} clears the weather`, async ({ page }) => {
    let requests = 0;
    await visit(page, noon, (route) =>
      ++requests === 1 ? route.fulfill(envelope('rain', noon)) : answer(route)
    );
    await expect(page.locator('.scene')).toHaveAttribute('data-weather', 'rain');
    // The 15-minute tick asks again; stop right after it, before the request's deadline.
    await page.clock.runFor(15 * minute);
    await expect.poll(() => requests).toBe(2);
    await expect(page.locator('.scene')).toHaveAttribute('data-weather', 'none');
    await expect(page.locator('.room-window')).not.toHaveAttribute('aria-label', /°C/);
  });
}

// Catches a fixtures-mode build (local, CI, Previews) asking the production API, or showing
// sample weather as if it were current.
test('in fixtures mode the room asks for no weather and shows none', async ({ page }) => {
  const asked: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/v1/weather')) asked.push(request.url());
  });
  await page.clock.install({ time: noon });
  await page.goto('/');
  await none(page);
  await page.clock.runFor(20 * minute);
  expect(asked).toEqual([]);
});

// Catches the weather layer or its label showing without the script.
test('without JavaScript the window has no weather', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(`${baseURL}/`);
  const layer = await page
    .locator('.room-weather')
    .evaluate((element) => getComputedStyle(element).backgroundImage);
  expect(layer).toBe('none');
  await expect(page.locator('.scene')).not.toHaveAttribute('data-weather', /.*/);
  await context.close();
});

// The room asks once on load and then every 15 minutes at most, while visible (ADR 0029).
// Catches a request per minute tick (1,440 a day per open tab instead of 96), and requests that
// pile up while one is outstanding.
test('the room asks for weather on load, then every 15 minutes', async ({ page }) => {
  let requests = 0;
  await visit(page, noon, (route) => {
    requests++;
    return route.fulfill(envelope('rain', noon));
  });
  await expect.poll(() => requests).toBe(1);
  await page.clock.runFor(14 * minute);
  expect(requests).toBe(1);
  // The 15-minute tick asks again. Stop the clock right after it: the fake clock also runs the
  // request's 5 s deadline, which would abort it before the route sees it.
  await page.clock.runFor(minute);
  await expect.poll(() => requests).toBe(2);
});

// Catches weather that outlives its age limit because no new answer came: the minute tick
// expires it without asking (ADR 0029). The answer's values are 40 minutes old, so they may
// show for 5 more minutes.
test('the window drops weather when it gets too old, without a new request', async ({ page }) => {
  let requests = 0;
  await visit(page, noon, (route) => {
    requests++;
    return route.fulfill(envelope('rain', noon, { observedAgoMs: 40 * minute }));
  });
  await expect(page.locator('.scene')).toHaveAttribute('data-weather', 'rain');
  await page.clock.runFor(4 * minute);
  await expect(page.locator('.scene')).toHaveAttribute('data-weather', 'rain');
  await page.clock.runFor(2 * minute);
  await expect(page.locator('.scene')).toHaveAttribute('data-weather', 'none');
  expect(requests).toBe(1);
});

declare global {
  interface Window {
    setHidden(hidden: boolean): void;
  }
}

// Catches a tab that comes back after a long sleep still showing old weather until its next
// minute tick, or waiting for a request that may hang.
test('a tab that comes back past the limit drops the weather at once', async ({ page }) => {
  await page.addInitScript(() => {
    let hidden = false;
    Object.defineProperty(document, 'hidden', { get: () => hidden });
    window.setHidden = (value: boolean) => {
      hidden = value;
      document.dispatchEvent(new Event('visibilitychange'));
    };
  });
  let requests = 0;
  await visit(page, noon, async (route) => {
    // Every request after the first hangs.
    if (++requests === 1) await route.fulfill(envelope('fog', noon));
  });
  await expect(page.locator('.scene')).toHaveAttribute('data-weather', 'fog');
  await page.evaluate(() => window.setHidden(true));
  await page.clock.fastForward(50 * minute);
  // Hidden, so no request yet.
  expect(requests).toBe(1);
  await page.evaluate(() => window.setHidden(false));
  await expect(page.locator('.scene')).toHaveAttribute('data-weather', 'none', { timeout: 1_000 });
  // Visible again and due: it asks once.
  await expect.poll(() => requests).toBe(2);
});

// Catches a refresh that hangs keeping old weather forever, and a window that never recovers
// once the API answers again.
test('a hanging refresh drops the weather at its deadline, and a later answer brings it back', async ({
  page,
}) => {
  let requests = 0;
  await visit(page, noon, async (route) => {
    requests++;
    if (requests === 2) return; // hangs
    await route.fulfill(envelope(requests === 1 ? 'rain' : 'snow', noon));
  });
  await expect(page.locator('.scene')).toHaveAttribute('data-weather', 'rain');
  await page.clock.runFor(15 * minute);
  await expect.poll(() => requests).toBe(2);
  // The page clock flows at real speed between steps, so the 5 s deadline takes 5 s.
  await expect(page.locator('.scene')).toHaveAttribute('data-weather', 'none', { timeout: 8_000 });
  // Jump rather than run: running would also play out the next request's deadline.
  await page.clock.fastForward(15 * minute);
  await expect(page.locator('.scene')).toHaveAttribute('data-weather', 'snow');
});

// Catches rain that keeps falling for people who asked for less motion, a layer that vanishes
// with its animation, or weather that changes with the motion setting (ADR 0029).
test('reduced motion stills the rain, and the weather stays', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await visit(page, noon, (route) => route.fulfill(envelope('storm', noon)));
  await expect(page.locator('.scene')).toHaveAttribute('data-weather', 'storm');
  const motion = () =>
    page
      .locator('.room-weather')
      .evaluate((layer) => [
        getComputedStyle(layer, '::before').animationName,
        getComputedStyle(layer, '::after').animationName,
      ]);
  expect(await motion()).toEqual(['rain', 'rain']);
  const before = await shown(page);

  // Changed while the page is open.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await motion()).toEqual(['none', 'none']);
  expect(await shown(page)).toEqual(before);
  expect(before.rain).toEqual(['weather-drops-day', 'weather-drops-day']);
});

for (const name of ['rain', 'snow'] as const) {
  test(`with reduced motion from the start, ${name} shows still`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await visit(page, noon, (route) => route.fulfill(envelope(name, noon)));
    await expect(page.locator('.scene')).toHaveAttribute('data-weather', name);
    expect(await shown(page)).toMatchObject({ layer: `weather-${name}-day` });
    const animations = await page
      .locator('.room-weather')
      .evaluate((layer) =>
        ['', '::before', '::after'].map(
          (pseudo) => getComputedStyle(layer, pseudo || null).animationName
        )
      );
    expect(animations).toEqual(['none', 'none', 'none']);
  });
}

// Catches the credit or the weather label failing contrast or naming rules in either theme.
for (const colorScheme of ['light', 'dark'] as const) {
  test(`home with weather has no axe violations (${colorScheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await visit(page, noon, (route) => route.fulfill(envelope('rain', noon)));
    await expect(page.locator('.scene')).toHaveAttribute('data-weather', 'rain');
    await expect(page.getByRole('link', { name: 'Open-Meteo' })).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
      .analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.length} nodes`)).toEqual([]);
  });
}
