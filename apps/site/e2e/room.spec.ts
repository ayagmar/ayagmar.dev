import type { Page } from '@playwright/test';
import sharp from 'sharp';
import { expect, expectNoAxeViolations, test } from './fixtures.ts';

// The page background of each theme (--ground in base.css).
const ground = { day: 'rgb(246, 242, 234)', night: 'rgb(14, 12, 19)' } as const;

const background = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);

// The background recorded in the page's first animation frame, which can run after goto() ends.
const firstFrame = async (page: Page) => {
  await page.waitForFunction(() => typeof window.firstFrame === 'string');
  return page.evaluate(() => window.firstFrame);
};

declare global {
  interface Window {
    firstFrame: string;
    entrances: number;
  }
}

for (const { system, choice } of [
  { system: 'light', choice: 'night' },
  { system: 'dark', choice: 'day' },
] as const) {
  // Catches a choice that is not stored, not read on the next page, or applied only after the
  // page has painted once in the system theme (a flash).
  test(`a ${choice} choice on a ${system} system holds across pages from the first frame`, {
    tag: '@drafts',
  }, async ({ page }) => {
    await page.emulateMedia({ colorScheme: system });
    await page.addInitScript(() => {
      requestAnimationFrame(() => {
        window.firstFrame = getComputedStyle(document.documentElement).backgroundColor;
      });
    });
    await page.goto('/');
    const systemTheme = system === 'light' ? 'day' : 'night';
    expect(await background(page)).toBe(ground[systemTheme]);

    const theme = page.getByRole('group', { name: 'Theme' });
    await theme.getByRole('button', { name: choice }).click();
    await expect(theme.getByRole('button', { pressed: true })).toHaveText(new RegExp(choice, 'i'));
    expect(await background(page)).toBe(ground[choice]);

    await page.goto('/writing/token-logs');
    expect(await firstFrame(page)).toBe(ground[choice]);
    await expect(theme.getByRole('button', { pressed: true })).toHaveText(new RegExp(choice, 'i'));

    // Auto forgets the choice: the next page follows the system again.
    await theme.getByRole('button', { name: 'Auto' }).click();
    await page.goto('/about');
    expect(await firstFrame(page)).toBe(ground[systemTheme]);
  });
}

// Catches a switch that shows up but cannot work, a page that needs JavaScript for its theme,
// or a room detail that shows a guess without its script.
test('without JavaScript the page follows the system theme and hides the switch', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false, colorScheme: 'dark' });
  const page = await context.newPage();
  await page.goto(`${baseURL}/`);
  expect(await background(page)).toBe(ground.night);
  await expect(page.getByRole('group', { name: 'Theme' })).toBeHidden();
  // The room stays the static night scene: no sky from a clock, no moon, no note.
  await expect(page.locator('.scene')).not.toHaveAttribute('data-sky', /.*/);
  await expect(page.locator('.room-note')).toBeHidden();
  // The objects are the build's, the words on them dated, and the record rests.
  await expect(page.locator('.room-pins li').first()).toBeVisible();
  await expect(page.locator('.room-screen i[data-l="4"]').first()).toBeVisible();
  await expect(page.locator('.scene')).toHaveAttribute('data-record', 'resting');
  await expect(page.locator('[data-room="frame"]')).toHaveAccessibleName(
    /^Framed screen: LLM usage\. .+ tokens, .+, as of .+\.$/
  );
  // The keys button would open nothing.
  await expect(page.getByRole('button', { name: 'Keys' })).toBeHidden();
  await context.close();
});

// Catches a scene downloading that the room does not show, whether the stored choice differs from
// the system or the sky brings the night scene over the day one, more than one window layer (ADR
// 0027), the cat out of its hours or not as its one layer, and italic text on home, which puts
// another font in front of the scene and pushes mobile LCP past 2 s. Each list is exact, and the
// clock is fixed, so this holds at any hour; responses, as a fixed clock empties `performance`.
for (const [theme, time, room] of [
  ['day', '2026-10-26T12:00:00Z', ['room-day', 'window-day']],
  ['day', '2026-10-26T17:55:00Z', ['room-day', 'room-night', 'window-dusk']],
  ['day', '2026-10-26T21:00:00Z', ['room-day', 'room-night', 'window-night']],
  ['day', '2026-10-26T03:00:00Z', ['cat-night', 'room-day', 'room-night-dim', 'window-night']],
  ['day', '2026-10-26T06:00:00Z', ['room-day', 'room-night-dim', 'window-night']],
  ['night', '2026-10-26T12:00:00Z', ['room-night', 'window-day']],
  ['night', '2026-10-26T03:00:00Z', ['cat-night', 'room-night-dim', 'window-night']],
] as const) {
  test(`home loads only what the room shows: ${theme} theme at ${time}`, async ({ page }) => {
    const assets: string[] = [];
    page.on('response', (response) => {
      const name = response.url().match(/\/_astro\/([\w-]+)\.[\w-]+\.(?:png|woff2)$/)?.[1];
      if (name !== undefined) assets.push(name);
    });
    await page.clock.setFixedTime(time);
    await page.emulateMedia({ colorScheme: theme === 'day' ? 'dark' : 'light' });
    await page.addInitScript((choice) => localStorage.setItem('theme', choice), theme);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    // Night theme's first paint can fetch the lit scene before room.ts turns the lamp down, so
    // in that one state it may or may not have started; every other list is exact.
    const racing = theme === 'night' && room.some((name) => name === 'room-night-dim');
    const loaded = assets.filter((name) => !(racing && name === 'room-night'));
    expect(loaded.toSorted()).toEqual(['mono', ...room, 'serif-roman'].toSorted());
  });
}

const roomLinks = (page: Page) =>
  page.locator('.scene a').evaluateAll((links) => links.map((link) => link.getAttribute('href')));

// Catches a hotspot and the list drifting apart, a destination that does not exist, and
// hotspots too small to hit (WCAG 2.2 target size) or covering the list on narrow phones.
test('the hotspots and the list reach the same pages', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  const list = await page
    .getByRole('navigation', { name: 'The room as a list' })
    .getByRole('link')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href')));
  expect(list).toHaveLength(7);
  expect(await roomLinks(page)).toEqual(list);

  for (const href of new Set(list)) {
    const [path = '', id] = (href ?? '').split('#');
    const response = await request.get(path);
    expect(response.status(), href ?? '').toBe(200);
    if (id !== undefined) expect(await response.text(), href ?? '').toContain(`id="${id}"`);
  }

  for (const width of [360, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    for (const hotspot of await page.locator('.scene a:visible').all()) {
      await expect(hotspot).toHaveAccessibleName(/.+: .+/);
      const box = await hotspot.boundingBox();
      expect(box?.width, `${width}px`).toBeGreaterThanOrEqual(24);
      expect(box?.height, `${width}px`).toBeGreaterThanOrEqual(24);
    }
  }
  await page.setViewportSize({ width: 320, height: 800 });
  await expect(page.locator('.scene a:visible')).toHaveCount(0);
});

// Catches a spine turned into a link or a tab stop (too small a target, ADR 0043), a draft on the
// published shelf, and a Notebook that says something other than what the shelf holds. The count
// comes from /writing, the list the shelf must equal.
for (const [build, details] of [
  ['published', {}],
  ['drafts', { tag: '@drafts' }],
] as const) {
  test(
    `the shelf holds the ${build} build's posts and says so on the Notebook`,
    details,
    async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto('/writing');
      const titles = await page.locator('ul.posts > li > a').allTextContents();
      await page.goto('/');
      const spines = page.locator('.room-books li');
      await expect(spines).toHaveCount(Math.min(titles.length, 19));
      if (build === 'drafts') expect(titles.length).toBeGreaterThan(0);
      await expect(page.locator('.room-books a, .room-books [tabindex]')).toHaveCount(0);
      await expect(page.locator('.scene a')).toHaveCount(7);
      await expect(page.locator('[data-room="notebook"]')).toHaveAccessibleName(
        titles.length === 0
          ? 'Notebook: writing. No posts yet.'
          : new RegExp(`^Notebook: writing\\. ${titles.length} posts?, newest: .+\\.$`)
      );
    }
  );
}

// Catches an object in the list that lights nothing: the rule names each object, so a new one in
// src/lib/room.ts needs its line in room.css. Also a row lighting the wrong object, or two.
test('hovering or focusing a row of the list lights its object in the room', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  const lit = () =>
    page.locator('.hotspot').evaluateAll((spots) =>
      spots
        .filter((spot) => getComputedStyle(spot).borderTopColor !== 'rgba(0, 0, 0, 0)')
        .filter((spot) => getComputedStyle(spot.querySelector('span') as Element).opacity === '1')
        .map((spot) => spot.getAttribute('data-room'))
    );
  const rows = await page.locator('[data-room-list]').all();
  expect(rows).toHaveLength(7);
  for (const row of rows) {
    const id = await row.getAttribute('data-room-list');
    await row.hover();
    expect(await lit()).toEqual([id]);
    await page.mouse.move(0, 0);
    expect(await lit()).toEqual([]);
    await row.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    expect(await lit()).toEqual([id]);
    await row.blur();
  }
});

// Catches an object that lights no row, or the wrong one: the reverse rule in room.css also names
// each object.
test('hovering or focusing an object lights its row in the list', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.goto('/');
  const lamp = await page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--lamp)';
    document.body.append(probe);
    return getComputedStyle(probe).color;
  });
  const lit = () =>
    page
      .locator('[data-room-list]')
      .evaluateAll(
        (rows, colour) =>
          rows
            .filter(
              (row) =>
                getComputedStyle(row.querySelector('.room-section') as Element).color === colour
            )
            .map((row) => row.getAttribute('data-room-list')),
        lamp
      );
  // Polled: a hover's colour change is a 120 ms transition (ADR 0037).
  for (const spot of await page.locator('.hotspot').all()) {
    const id = await spot.getAttribute('data-room');
    await spot.hover();
    await expect.poll(lit).toEqual([id]);
    await page.mouse.move(0, 0);
    await expect.poll(lit).toEqual([]);
    await spot.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect.poll(lit).toEqual([id]);
    await spot.blur();
  }
});

// Catches the entrance replaying on a reload or a return to home, playing on arrival from another
// page, moving anything for readers who asked for less motion, or hiding the name without scripts.
test.describe('the entrance', () => {
  const armed = (page: Page) => page.locator('html[data-entrance]');
  const name = (page: Page) =>
    page.locator('.intro').evaluate((intro) => getComputedStyle(intro).animationName);
  /** Counts the entrance's animations in each new document, as the first may end before a read. */
  const countStarts = (page: Page) =>
    page.addInitScript(() => {
      window.entrances = 0;
      document.addEventListener('animationstart', (event) => {
        if (event.animationName === 'arrive') window.entrances += 1;
      });
    });
  const starts = (page: Page) => page.evaluate(() => window.entrances);

  test('plays once, only when home opens the session', async ({ page }) => {
    await countStarts(page);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/');
    await expect.poll(() => starts(page)).toBe(2);
    await page.reload();
    await page.waitForLoadState('load');
    expect(await starts(page)).toBe(0);
    expect(await name(page)).toBe('none');
    await page.goto('/about');
    await page.goto('/');
    expect(await name(page)).toBe('none');
  });

  // Catches the pitch fading in with the entrance: it is home's largest text, and a fade puts
  // mobile LCP at the fade's end, over the 2.0 s budget (ADR 0037).
  test('leaves the pitch and the links visible from the first paint', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/');
    await expect(armed(page)).toHaveCount(1);
    const animated = await page.locator('.intro-pitch').evaluate((pitch) => {
      const names: string[] = [];
      for (let node: Element | null = pitch; node !== null; node = node.parentElement) {
        names.push(getComputedStyle(node).animationName);
      }
      return names.filter((name) => name !== 'none');
    });
    expect(animated).toEqual([]);
  });

  test('does not play when the session starts on another page', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/about');
    await page.getByRole('link', { name: 'min7' }).first().click();
    await expect(page).toHaveURL(/\/$/);
    expect(await name(page)).toBe('none');
  });

  // Catches a trigger left on <html>: the animation comes back with the preference and hides the
  // name again, long after the page settled.
  test('cannot replay when the motion preference changes after it ends', async ({ page }) => {
    await countStarts(page);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/');
    await expect.poll(() => starts(page)).toBe(2);
    await expect(armed(page)).toHaveCount(0);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    expect(await name(page)).toBe('none');
    expect(await starts(page)).toBe(2);
  });

  // Catches a page left mid-entrance coming back from the back/forward cache still armed. A real
  // restore needs a cache Playwright's browser has off, so the events are synthetic (ADR 0042).
  test('leaving retires it, so a restored page stays still', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/');
    await page.evaluate(() => {
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });
    await expect(armed(page)).toHaveCount(0);
    expect(await name(page)).toBe('none');
  });

  // Catches a trigger left dormant for a reader who starts with reduced motion and later turns
  // it off: nothing ends it, as nothing ever ran.
  test('stays still with reduced motion, and is not left waiting', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    expect(await name(page)).toBe('none');
    await expect(armed(page)).toHaveCount(0);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    expect(await name(page)).toBe('none');
  });

  test('never hides the name without JavaScript', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(`${baseURL}/`);
    await expect(page.locator('.intro')).toHaveCSS('opacity', '1');
    await context.close();
  });
});

// Catches the optional lighting taking the hotspot's own hover down with it: a browser that cannot
// parse one selector drops its whole rule. Every `:has()` rule goes, as there, and a hotspot must
// still light and show its label under the pointer and the keyboard. The list then lights nothing.
test('a hotspot lights by itself without :has()', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  const dropped = await page.evaluate(() => {
    let count = 0;
    const drop = (list: CSSRuleList, owner: CSSStyleSheet | CSSGroupingRule) => {
      for (let i = list.length - 1; i >= 0; i -= 1) {
        const rule = list[i];
        if (rule instanceof CSSGroupingRule) drop(rule.cssRules, rule);
        if (rule instanceof CSSStyleRule && rule.selectorText.includes(':has(')) {
          owner.deleteRule(i);
          count += 1;
        }
      }
    };
    for (const sheet of document.styleSheets) drop(sheet.cssRules, sheet);
    return count;
  });
  expect(dropped).toBeGreaterThan(0);
  const spot = page.locator('[data-room="monitor"]');
  const label = spot.locator('span');
  const unlit = await spot.evaluate((el) => getComputedStyle(el).borderTopColor);
  await spot.hover();
  await expect(label).toHaveCSS('opacity', '1');
  // Polled: a hover's colour change is a 120 ms transition (ADR 0037).
  await expect
    .poll(() => spot.evaluate((el) => getComputedStyle(el).borderTopColor))
    .not.toBe(unlit);
  await page.mouse.move(0, 0);
  await expect(label).toHaveCSS('opacity', '0');
  await page.locator('[data-room="notebook"]').focus();
  await page.keyboard.press('Tab');
  await expect(spot).toBeFocused();
  await expect(label).toHaveCSS('opacity', '1');
  await page.locator('[data-room-list="tea"]').hover();
  await expect(page.locator('[data-room="tea"] span')).toHaveCSS('opacity', '0');
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  // Catches the room scaling down to a 390x130 strip, pixels that stop being square, a crop that
  // scrolls the page sideways, and hotspots hanging off the edge of the view.
  test('the room is cropped at twice its pixels, and the list still reaches everything', async ({
    page,
  }) => {
    await page.goto('/');
    const scene = await page.locator('.scene').boundingBox();
    expect([scene?.width, scene?.height]).toEqual([960, 320]);
    const view = await page.evaluate(() => [
      document.documentElement.scrollWidth,
      document.documentElement.clientWidth,
    ]);
    expect(view).toEqual([390, 390]);
    const spots = await page.locator('.scene a:visible').all();
    const shown = await Promise.all(spots.map((spot) => spot.getAttribute('data-room')));
    expect(shown).toEqual(['notebook', 'monitor', 'keyboard']);
    for (const spot of spots) {
      const box = await spot.boundingBox();
      expect(box?.x).toBeGreaterThanOrEqual(0);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
    }
    await expect(page.locator('[data-room-list]:visible')).toHaveCount(7);
  });
});

// The three placeholder drafts carry art (ADR 0027). Their pages, and home listing them, are
// checked on the drafts build; /writing/token-logs in reader.spec.ts.
for (const [path, details] of [
  ['/', { tag: '@drafts' }],
  ['/writing/ephemeral-runners', { tag: '@drafts' }],
  ['/writing/cache-reads', { tag: '@drafts' }],
  ['/about', {}],
  ['/stats', {}],
] as const) {
  // Catches text or links that lose contrast in the night theme (pages.spec.ts checks the day).
  test(`${path} has no axe violations at night`, details, async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto(path);
    await expect(page.getByRole('button', { name: /search/i })).toBeVisible();
    await expectNoAxeViolations(page);
  });
}

// Catches motion that keeps running for people who asked for less (the record: signals.spec.ts).
test('reduced motion stops the lamp', async ({ page }) => {
  const lamp = () =>
    page.locator('.room-art.night').evaluate((art) => getComputedStyle(art).animationName);
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'no-preference' });
  await page.goto('/');
  expect(await lamp()).toBe('lamp-on');
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  expect(await lamp()).toBe('none');
});

// The room's clock (ADR 0027). The visitor is in Auckland, 13 hours ahead of Rabat, so a
// window that followed the visitor's clock or the page theme would show the wrong sky.
test.describe('the room keeps Rabat time', () => {
  test.use({ timezoneId: 'Pacific/Auckland' });

  const room = (page: Page) =>
    page.locator('.scene').evaluate((scene) => {
      const image = (selector: string) =>
        getComputedStyle(scene.querySelector(selector) as Element).backgroundImage.match(
          /\/_astro\/([\w-]+)\./
        )?.[1] ?? null;
      return {
        sky: scene.getAttribute('data-sky'),
        window: image('.room-window'),
        night: image('.room-art.night'),
        moon: scene.querySelector('.room-moon path')?.getAttribute('d') ?? '',
      };
    });

  // `patch` runs after the clock is installed: Playwright's clock cannot wrap an Intl.DateTimeFormat
  // replaced before it, and then leaves the page on the real time.
  const visit = async (
    page: Page,
    time: string,
    colorScheme: 'light' | 'dark',
    patch?: () => Promise<unknown>
  ) => {
    await page.clock.setFixedTime(time);
    await patch?.();
    await page.emulateMedia({ colorScheme });
    await page.goto('/');
    expect(await page.evaluate(() => Date.now())).toBe(Date.parse(time));
    await expect(page.locator('.scene')).toHaveAttribute('data-sky', /.+/);
  };

  // 03:00 in Rabat (+00) on the full moon of 26 Oct 2026, a sunny afternoon in Auckland.
  test('at 03:00 the window shows the night and the moon, and the lamp is down', async ({
    page,
  }) => {
    await visit(page, '2026-10-26T03:00:00Z', 'light');
    expect(await room(page)).toMatchObject({ sky: 'night', window: 'window-night' });
    expect((await room(page)).moon).not.toBe('');
    await expect(page.getByRole('img', { name: /night over Rabat, a full moon/ })).toBeVisible();
    await expect(page.locator('.room-note')).toHaveText('Probably asleep: it is 03:00 in Rabat.');

    await page.emulateMedia({ colorScheme: 'dark' });
    expect((await room(page)).night).toBe('room-night-dim');
  });

  test('at noon the window shows the day, with no moon and no note', async ({ page }) => {
    await visit(page, '2026-10-26T12:00:00Z', 'dark');
    expect(await room(page)).toEqual({
      sky: 'day',
      window: 'window-day',
      night: 'room-night',
      moon: '',
    });
    await expect(page.locator('.room-note')).toBeHidden();
  });

  // Catches a browser whose tzdata predates 2026c dimming the lamp on the wrong hour: it still
  // puts Rabat at +01, so at 01:30 there it would say 02:30 and show "probably asleep" and the cat.
  // The sky and the moon come from UTC and stay.
  test('with outdated time zone rules the lamp stays on and no note shows', async ({ page }) => {
    await visit(page, '2026-10-26T01:30:00Z', 'dark', () =>
      page.addInitScript(() => {
        const Original = Intl.DateTimeFormat;
        // Etc/GMT-1 is +01 all year, as Morocco was before the rules changed.
        Intl.DateTimeFormat = class extends Original {
          constructor(locales?: string | string[], options?: Intl.DateTimeFormatOptions) {
            const outdated = options?.timeZone === 'Africa/Casablanca';
            super(locales, outdated ? { ...options, timeZone: 'Etc/GMT-1' } : options);
          }
        } as typeof Intl.DateTimeFormat;
      })
    );
    // With current rules 01:30 shows the same room, so check the old rules are really in place.
    const rabat = await page.evaluate(() =>
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Africa/Casablanca',
        timeStyle: 'short',
      }).format()
    );
    expect(rabat).toBe('02:30');
    expect(await room(page)).toMatchObject({
      sky: 'night',
      window: 'window-night',
      night: 'room-night',
    });
    expect((await room(page)).moon).not.toBe('');
    await expect(page.locator('.room-note')).toBeHidden();
    await expect(page.locator('.room-cat')).toBeHidden();
  });

  // Catches the cat missing its hours or waiting for a reload, moving the page when it comes,
  // a note the keyboard cannot reach or cut off by the scene's edge on a phone, and a sunlit cat
  // in the Day theme: these hours are always dark.
  test('a cat sleeps on the sill from 02:00 to 05:00, and says so on focus', async ({ page }) => {
    const cat = page.getByRole('img', { name: /cat asleep on the windowsill/ });
    const art = () =>
      page
        .locator('.room-cat')
        .evaluate((layer) => getComputedStyle(layer).backgroundImage.match(/cat-\w+/)?.[0]);
    await page.clock.install({ time: '2026-10-26T01:59:30Z' });
    // Still, so the name's position below is not the entrance's.
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await page.goto('/');
    await expect(page.locator('.scene')).toHaveAttribute('data-sky', 'night');
    await expect(cat).toBeHidden();
    const intro = await page.locator('.intro').boundingBox();

    await page.clock.runFor(60_000);
    await expect(cat).toBeVisible();
    expect(await page.locator('.intro').boundingBox()).toEqual(intro);
    expect(await art()).toBe('cat-night');
    await cat.focus();
    const note = cat.getByText('The cat keeps the night shift until five.');
    await expect(note).toBeVisible();
    for (const width of [320, 360, 390]) {
      await page.setViewportSize({ width, height: 800 });
      const box = await note.boundingBox();
      expect(box && box.x + box.width).toBeLessThanOrEqual(width);
    }
    await expectNoAxeViolations(page, '.room');
    await page.emulateMedia({ colorScheme: 'light' });
    expect(await art()).toBe('cat-night');
    await expectNoAxeViolations(page, '.room');

    await page.clock.runFor(3 * 60 * 60_000);
    await expect(cat).toBeHidden();
  });

  // Catches sunlit walls beside a night window, a layer that hides the window, and the theme
  // itself changing: only the room follows the sky.
  for (const [time, sky, opacity] of [
    ['2026-10-26T12:00:00Z', 'day', null],
    ['2026-10-26T17:55:00Z', 'dusk', '0.5'],
    ['2026-10-26T21:00:00Z', 'night', '0.85'],
  ] as const) {
    test(`the Day theme's room follows a ${sky} sky`, async ({ page }) => {
      await visit(page, time, 'light');
      const layer = await page.locator('.room-art.day').evaluate((art) => {
        const after = getComputedStyle(art, '::after');
        return after.content === 'none' ? null : after.opacity;
      });
      expect(layer).toBe(opacity);
      expect(await background(page)).toBe(ground.day);
      expect(await room(page)).toMatchObject({ sky, window: `window-${sky}` });
      const order = await page.evaluate(() => {
        const art = document.querySelector('.room-art.day') as Element;
        const view = document.querySelector('.room-window') as Element;
        return art.compareDocumentPosition(view) === Node.DOCUMENT_POSITION_FOLLOWING;
      });
      expect(order).toBe(true);
    });
  }

  test('just after sunset the window shows dusk', async ({ page }) => {
    await visit(page, '2026-10-26T17:55:00Z', 'dark');
    expect(await room(page)).toMatchObject({ sky: 'dusk', window: 'window-dusk' });
  });
});

// Catches a key that does nothing, the list missing a key, or the room's keys leaking onto
// pages without the room.
test('? lists the keys, and t and the room numbers work', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  const keys = page.getByRole('dialog', { name: 'Keyboard' });
  await page.keyboard.press('?');
  await expect(keys).toBeVisible();
  await expect(keys.getByText(/^Corkboard: shipping$|^Record player: music$/)).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(keys).toBeHidden();

  await page.keyboard.press('t');
  expect(await background(page)).toBe(ground.day);
  await page.keyboard.press('t');
  expect(await background(page)).toBe(ground.night);

  await page.keyboard.press('3');
  await expect(page).toHaveURL(/\/writing$/);
  await page.keyboard.press('?');
  await expect(keys).toBeVisible();
  await expect(keys.getByText('Corkboard: shipping')).toHaveCount(0);
});

// WCAG 2.1.4: single-character shortcuts can be turned off. Catches a switch that does not
// persist to the next page, a bare key that ignores it (?, t, 1 to 7, search's /), and Ctrl K
// switched off with them.
test('the keys switch turns every single-key shortcut off, on every page', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/writing');
  const keys = page.getByRole('dialog', { name: 'Keyboard' });
  const shortcuts = keys.getByRole('switch', { name: /single-key shortcuts/i });
  await page.getByRole('button', { name: 'Keys' }).click();
  await expect(shortcuts).toBeChecked();
  await shortcuts.click();
  await expect(shortcuts).not.toBeChecked();
  await page.keyboard.press('Escape');

  await page.goto('/');
  const search = page.getByRole('dialog', { name: 'Search' });
  await expect(page.getByRole('button', { name: /search/i })).toBeVisible();
  for (const key of ['?', 't', '3', '/']) await page.keyboard.press(key);
  await page.keyboard.press('Control+k');
  await expect(search).toBeVisible();
  await expect(keys).toBeHidden();
  expect(await background(page)).toBe(ground.night);
  expect(new URL(page.url()).pathname).toBe('/');
  await page.keyboard.press('Escape');

  // On again, from the same button, and the keys work again.
  await page.getByRole('button', { name: 'Keys' }).click();
  await expect(shortcuts).not.toBeChecked();
  await shortcuts.click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('t');
  expect(await background(page)).toBe(ground.day);
});

for (const colorScheme of ['light', 'dark'] as const) {
  // Catches a switch without a name or state, or with too little contrast, in either theme.
  test(`the keys dialog has no axe violations (${colorScheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto('/');
    await page.getByRole('button', { name: 'Keys' }).click();
    await expect(page.getByRole('dialog', { name: 'Keyboard' })).toBeVisible();
    await expectNoAxeViolations(page, 'dialog.keys');
  });
}

/**
 * Pixels of the post's art at least `apart` from the ground under it, summed over red, green and
 * blue. Cream on white is 95 apart, the palest ink on white over 350. The shot loses its edge
 * because a fractional layout leaves a column of the page's background in it, enough to pass as ink.
 */
async function inkPixels(page: Page, apart: number) {
  const shot = sharp(await page.locator('.post-art svg').screenshot());
  const { width = 0, height = 0 } = await shot.metadata();
  const { data, info } = await shot
    .extract({ left: 2, top: 2, width: width - 4, height: height - 4 })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let ink = 0;
  for (let at = 0; at < data.length; at += info.channels) {
    const distance = [0, 1, 2].reduce(
      (sum, channel) => sum + Math.abs((data[at + channel] ?? 0) - (data[channel] ?? 0)),
      0
    );
    if (distance >= apart) ink++;
  }
  return ink;
}

/** The art of a post with all three tones, cut down to one, as a map of that tone would draw. */
async function oneTone(page: Page, tone: string) {
  await page.goto('/writing/cache-reads');
  await page.locator('.post-art svg').evaluate((svg, keep) => {
    for (const path of svg.querySelectorAll('path')) {
      if (!path.classList.contains(keep)) path.remove();
    }
  }, tone);
}

// Catches art that vanishes on paper: the night theme's cream strokes print on white, and the
// page's background does not print at all. A map may be a single tone, so each must show alone.
for (const theme of ['night', 'day']) {
  test(`post art prints dark on white with the ${theme} theme`, { tag: '@drafts' }, async ({
    page,
  }) => {
    await page.addInitScript((choice) => localStorage.setItem('theme', choice), theme);
    await page.emulateMedia({ media: 'print' });
    for (const tone of ['bright', 'dim', 'accent']) {
      await oneTone(page, tone);
      await page.locator('.post-art svg').evaluate((svg) => {
        (svg as SVGElement).style.background = '#fff';
      });
      expect(await inkPixels(page, 250), tone).toBeGreaterThan(50);
    }
  });
}

// Catches art lost in forced colors: SVG keeps its author colours there, so a tone can equal the
// user's canvas. Every tone must take the text colour, and no plate may be painted.
for (const colorScheme of ['dark', 'light'] as const) {
  test(`post art uses the text colour in forced colors on a ${colorScheme} canvas`, {
    tag: '@drafts',
  }, async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active', colorScheme });
    for (const tone of ['bright', 'dim', 'accent']) {
      await oneTone(page, tone);
      expect(await inkPixels(page, 90), tone).toBeGreaterThan(50);
    }
    await page.goto('/writing/cache-reads');
    const seen = await page.locator('.post-art svg').evaluate((svg) => ({
      plate: getComputedStyle(svg.querySelector('.ground') as Element).fill,
      tones: [...svg.querySelectorAll('path')].map((path) => getComputedStyle(path).stroke),
      text: getComputedStyle(document.body).color,
    }));
    expect(seen.plate).toBe('none');
    expect(new Set([...seen.tones, seen.text]).size).toBe(1);
  });
}

// Catches art missing from a post that asks for it, drawn on a post that does not, or a tone that
// matches the ground it sits on and leaves the figure invisible in one theme.
for (const colorScheme of ['dark', 'light'] as const) {
  test(`post art shows against the ${colorScheme} ground`, { tag: '@drafts' }, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    for (const path of [
      '/writing/token-logs',
      '/writing/ephemeral-runners',
      '/writing/cache-reads',
    ]) {
      await page.goto(path);
      await expect(page.locator('.post-art svg.art-dots')).toBeVisible();
      const seen = await page.locator('.post-art svg').evaluate((svg) => ({
        ground: getComputedStyle(document.body).backgroundColor,
        plate: getComputedStyle(svg.querySelector('.ground') as Element).fill,
        tones: [...svg.querySelectorAll('path')].map((path) => getComputedStyle(path).stroke),
      }));
      expect(seen.plate).toBe('rgba(0, 0, 0, 0)');
      expect(seen.tones).toHaveLength(3);
      expect(new Set([...seen.tones, seen.ground]).size).toBe(4);
    }
    await page.goto('/writing/ricing-niri');
    await expect(page.locator('.post-art')).toHaveCount(0);
  });
}
