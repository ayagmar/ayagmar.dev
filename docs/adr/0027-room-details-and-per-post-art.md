# 0027. Room details and per-post art

Status: accepted, 2026-10-26. Amended 2026-11-01: a post's art also draws its link-preview image (see Link previews below). Amended 2026-10-26: the room follows Rabat (Hassan Tower, 34.0240 N, 6.8228 W), where the owner lives, instead of Casablanca; the time zone is still `Africa/Casablanca`, which covers all of Morocco. Amended 2026-10-26: the now-playing island became a page script shared with /stats (ADR 0015); the record's rules below hold, and a hung request now ends after a 5 s deadline.

## Context

ADR 0026 left the room static and the post page's `art` slot empty. The owner asked for six details, and nothing more:
1. The window shows the real moon phase, and its sky follows the real sun over Rabat: day, dusk, night. The page theme's Auto stays on `prefers-color-scheme`; the window is the room's clock, not the visitor's.
2. The record turns only when Last.fm says something is playing now.
3. Between 02:00 and 07:00 Rabat time the lamp dims and a small "probably asleep" note appears.
4. `curl ayagmar.dev` prints the room as ASCII art above the text index.
5. A `?` list of keyboard shortcuts (search, theme, the room's objects) and a short note for people who read the page source.
6. Optional per-post art from frontmatter, drawn at build time from the room's palette, with no JavaScript.

Every detail has to keep what ADRs 0019, 0026 and the budgets of ADR 0017 promise: a strict CSP, no other origins, axe-clean pages in both themes, no layout shift, and no new JavaScript on pages that do not need it. Each one must also degrade to a correct static room: without JavaScript, with reduced motion, with a failed or stale now-playing answer, and for a visitor in another time zone.

## Decision

### The room's clock: window, moon, lamp

`apps/site/src/lib/sky.ts` computes everything from an instant, with no state. `apps/site/src/scripts/room.ts` runs it on the home page only, once on load and then every minute, and sets three things on `.scene`:
- `data-sky` is `day`, `dusk` or `night`. `room.css` then shows one of three window layers, `window-{day,dusk,night}.png`. Each is the full 480x160 scene, transparent except the view through the window, so it lines up with the scene at any size. The window frame, the mullions and the lamp in front stay in the room's own scene, so they keep the room's light. Only the layer in use downloads (1.3 to 1.4 KiB each).
- The moon is an inline SVG over the scene in the same 480x160 coordinates. The script writes its `path`: the lit part of a 12-pixel disc, a run of unit squares per row, lit on the right while waxing as seen from Morocco, in the palette's moon colour `#e8e8fa`. It is drawn at dusk and at night, and left out when less than 3 % is lit.
- `data-late` between 02:00 and 07:00 Rabat time swaps the night scene for `room-night-dim.png` (the lamp at a third of its light, the bulb a dim amber) and shows the note `Probably asleep: it is 03:12 in Rabat.` The note sits over the desk's front edge, below every hotspot, positioned absolutely, so showing it moves nothing. In the day theme the lamp is already off; only the note appears.

The window element gets `role="img"` and a label such as "Through the window: night over Rabat, a waxing gibbous moon." from the script. The room's own text alternatives no longer mention the sky.

Day is when the sun's centre is above −0.833° (NOAA's sunrise and sunset), dusk is civil twilight (down to −6°), night is below that. Dawn uses the dusk sky. The moon's position in the sky is not modelled: at night the window shows the phase, whether or not the moon has risen.

`scripts/scene.py` (`just scene`) draws the three window layers and the dim room next to the two scenes. It records which pixels are the view while it draws the sky and skyline; anything drawn later (the mullions, the lamp) clears them, and only the remaining view goes into a layer.

**Sources.**
- Sun: the NOAA Solar Calculator's own equations, from its code (`calcSunDeclination`, `calcEquationOfTime`, `calcAzEl` in https://gml.noaa.gov/grad/solcalc/main.js, read 2026-10-26), which follow Meeus. The terms in t² and t³ are left out: this century they move the sun by under 0.0001°.
- Moon: Meeus, _Astronomical Algorithms_, 2nd edition (Willmann-Bell, 1998): the mean elongation D and the anomalies M and M′ of chapter 47, and the phase angle i of formula 48.4 with its six periodic terms. The illuminated fraction is (1 + cos i) / 2. A named phase (new, first quarter, full, last quarter) is shown within about half a day of its instant (6.1° of elongation); the in-between names otherwise. Chapter 49's phase instants are not needed: the elongation gives the phase at any instant directly.
- Time: `Intl.DateTimeFormat` with `timeZone: 'Africa/Casablanca'`, which reads the browser's IANA tzdata. No offset is written down anywhere.

**Why tzdata matters here.** Morocco ran at +01 with a change to +00 for Ramadan each year until 2026. The tzdata `africa` file (release 2026c) records Decree 2.26.530: Morocco moved to +00 for good on 2026-09-20 at 02:00, with no further clock changes. So there are no 2027 Ramadan changes to test around; the tests use the three 2026 changes (15 Feb, 22 Mar, 20 Sep). A hand-written +01 would now be an hour wrong every day. A browser whose tzdata predates 2026c still thinks Morocco is at +01, and would dim the lamp and print the note an hour off. So before it uses the hour, `room.ts` asks `knowsRabatTime()` in `sky.ts`, which formats 2026-10-01 12:00 UTC in Rabat and expects `12:00`. When the browser disagrees, the lamp stays as the theme draws it and the note stays hidden, as without JavaScript; the sky and the moon come from UTC and stay. Nothing writes the offset down: if Morocco changes its clocks again, that check moves with the new rules.

**The visitor's clock is trusted.** The sky, the moon and the lamp all start from the device's `Date.now()`. A device clock that is hours off shows the wrong sky, and one that is an hour off near 02:00 or 07:00 shows the note when it should not, or hides it. This is an accepted limitation, not checked for: the three details are decoration, the page has no trustworthy time without an extra request (a same-origin time anchor would cost a request on every visit and a new route), and a device clock that far off already breaks TLS certificate checks and most of the web for that visitor. The time zone the visitor picks never matters; only the clock does.

**Checks** (`apps/site/test/sky.test.ts`):
- Moon: the illuminated fraction on 12 dates in 2026 is within 3 points of NASA SVS Dial-A-Moon (https://svs.gsfc.nasa.gov/api/dialamoon/, JPL ephemeris; it measured within 0.25 points). The named phase at 12 instants over 2026 and 2027 from Espenak's catalogue (https://eclipse.gsfc.nasa.gov/phase/phases2001.html) matches, and the elongation is within one day's motion of the phase (it measured within 0.6 hours). The USNO API and timeanddate.com refused connections from the build machine, so these two sources stand in for them.
- Sun: sunrise and sunset on 8 dates, both sides of each 2026 clock change plus both solstices, are within 2 minutes of NOAA's calculator in Rabat local time (they measured within 1 minute).
- Lamp: over 2,000 seeded instants in 2026 and 2027, both sides of each clock change, and 01:59, 02:00, 06:59 and 07:00 local on days at either offset, `isLate` agrees with the hour read through `toLocaleString`.

### The record

The listening panel's record turns only while the now-playing island holds a live answer with a track: `/v1/listening` answered with `stale: false` (signals marks it stale 15 minutes after its last Last.fm fetch, `staleAfterSeconds` in `packages/contracts/src/sources.ts`) and a `nowPlaying` track. The island marks that with `data-playing`, and `room.css` turns the record with `.record:has([data-playing])`. The build-time value is never live, so a static page never claims music is playing; in fixtures mode the island never fetches, so the record rests.

A live answer stays live only until its `fetchedAt` plus the same 15 minutes (the panel passes `staleAfterSeconds.listening` to the island). The island's minute timer checks that before it asks again, whether or not the last request came back, so the record stops within a minute of the limit while requests hang or fail; a tab that comes back visible checks it first too. An answer whose `fetchedAt` does not parse or lies more than 2 minutes in the future is ignored. A failed, ignored or unreadable refresh ends the live state but keeps the last track and its time ("Playing … as of …").

### `curl ayagmar.dev`

`index.txt` starts with the room in ASCII (left to right as on the scene), then the existing index. The Worker's user-agent check is unchanged, so `curl`, `wget`, HTTPie and `xh` get it and browsers get HTML, both with `Vary: User-Agent`. Each answer comes from the assets binding with its own ETag, so a cache that keeps one cannot validate the other. The Worker runs first for `/` (`run_worker_first`), so Cloudflare's cache never answers `/` without it.

### Keys and the view-source note

`theme.js`, which every page already loads, now also handles two keys: `t` swaps day and night (from Auto it picks the opposite of the system theme), and `?` opens `dialog.keys`, a static list in `Base.astro`. On the home page `room.ts` adds `1` to `7`, which open the room's objects in reading order, and the list shows them. Search keeps `/` and Ctrl+K. Keys are ignored while typing in a field, while a dialog is open, and with Ctrl, Alt or Meta. Without JavaScript the list never opens and no key does anything.

These are single-character shortcuts, which WCAG 2.1.4 (level A) allows only if they can be turned off, remapped, or work only while their component has focus. The owner wants the playful keys, so they stay, with a way to turn them off:
- A **Keys** button at the end of every page's footer opens the same list, so the list and its switch are reachable with no shortcut at all. It shows only once `theme.js` has run, like the theme switch.
- The list has a switch, "Single-key shortcuts", on by default: a native checkbox with `role="switch"`. Turning it off stores `shortcuts=off` in `localStorage`, so it holds on every page and every visit, and `theme.js` mirrors it as `data-shortcuts="off"` on `<html>` before the first paint. `theme.js` (`?`, `t`), `room.ts` (`1` to `7`) and search (`/`) all check that attribute; Ctrl+K and Cmd+K keep opening search, since they use a modifier. When storage is blocked, the switch holds for the current page only.
- Escape on a dialog drops focus from the field or switch it held, so a hidden control does not swallow the next key.

`Base.astro` starts every page with an HTML comment for people who read the source: what the site is built from, where the code is, and the `?` and `curl` tricks. It costs about 0.2 KB per page before gzip.

### Per-post art

A post may set `art: { kind, seed, palette }` in its frontmatter (`writing-schema.ts`): `kind` is `ascii`, `dither` or `pattern`; `seed` a whole number (0 by default); `palette` one of five ramps of the room's colours (`night` by default, `lamp`, `screen`, `zellige`, `wood`). Posts without `art` get no figure. `apps/site/src/lib/art.ts` draws it at build time as inline SVG into PostHeader's `art` slot; the page ships no JavaScript for it.
- A mulberry32 generator, seeded with the FNV-1a hash of `<slug>:<seed>`, drives two octaves of value noise.
- `dither` maps the noise to the ramp with the 8x8 Bayer matrix of `scene.py`, 96x32 pixels, drawn as one stroked path per colour. `pattern` builds an 8x8 zellige-like tile, symmetric across both axes and the diagonal, and repeats it with an SVG `<pattern>`. `ascii` writes the noise as characters (` .:-=+*#%@`) in the mono font, coloured by the ramp, 48 by 8.
- Only arithmetic that is exact in IEEE doubles is used (no `Math.sin`), so every engine and Node version draws the same bytes. Golden files in `apps/site/test/golden/` fail the test on any change, and Biome is told not to format them.
- Every colour is one of the room's 41 (the base palette of `scene.py`; a test reads `scene.py` and compares). Each piece paints its own darkest colour behind it, so it reads the same on the day and the night paper.
- The SVG is `aria-hidden` (decoration; the title follows), and the figure has `data-pagefind-ignore`, since the ascii kind is text.

Sizes: dither about 4 KB gzip, ascii and pattern about 0.5 KB.

The three placeholder posts carry one kind each, so e2e and axe see all three in both themes. They are drafts, so those tests run on the build that shows drafts.

### Link previews

Every page names a 1200x630 PNG as `og:image`, with its size, a text alternative and `twitter:card` `summary_large_image` (`Base.astro`, paths and alternatives in `src/lib/og.ts`). Astro endpoints draw them at build time with sharp (`src/lib/og-card.ts`), so no page ships code for them: a post's card is its art at ten times its size, or the night room at twice its size when it has none, with the title in the serif and "min7 · Writing" under it on the night ground; a TIL note's is the room with its title; every other page shares `/og/default.png`, the room with the site's name and description. The title is 54 px and steps down to 36 px until it fits the text box, wrapping at words and inside a word too long for a line (an identifier, a digest); a title that still does not fit at 36 px is cut at the longest prefix that does, with an ellipsis, so no title can fail the build or run off the card. sharp's FreeType reads no WOFF2, so `just fonts` also writes TrueType copies of the roman and the mono to `src/fonts/ttf/` for the build; they never reach a page. The same endpoints write `/favicon.ico` (16 and 32 px) and `/apple-touch-icon.png` (180 px, opaque) from `public/favicon.svg`, a lit arched window in the lamp's amber on the night ground. `_headers` gives these fixed names a day's cache. `og:image` and `og:url` are absolute URLs on the origin the build is served from (`buildOrigin` in `src/lib/og.ts`), while `canonical` stays production: Workers Builds sets `WORKERS_CI_BRANCH`, `wrangler preview` names the Preview after it, and the Preview's URL is `<name>-min7-site.ayagmar.workers.dev`, so a Preview's card shows the Preview's own image, which production may not have yet. Cloudflare documents that URL pattern but not how a branch becomes the name; the rule used (lowercase, each run of other characters one hyphen) matches every Preview made so far. A branch whose name would not fit one DNS label gets production's URLs, as do builds outside Workers Builds (local, CI). `e2e/previews.spec.ts` checks that every built page's image is served at its size, and the icons' formats.

### The CSP and the build

The room script is imported from an Astro `<script>`, emitted as `/_astro/index.astro_astro_type_script_index_0_lang.<hash>.js`. Astro inlines a script smaller than Vite's `assetsInlineLimit`, which the CSP would block, so `astro.config.ts` sets the limit to 0: nothing is ever inlined. Inline `data:` assets were already blocked by `img-src 'self'`, so no output changes otherwise. The moon is drawn by setting an SVG attribute, which `style-src` does not cover.

### Cost

| What                       | Where      | Size (gzip)                          |
| -------------------------- | ---------- | ------------------------------------ |
| Room script (`room.ts`)    | home only  | 1,542 B                              |
| Theme script (`theme.js`)  | every page | 1,289 B (was 685 B)                  |
| Now-playing island         | home       | +156 B                               |
| Window layer               | home       | 1.3 to 1.4 KiB, one per visit        |
| Dim night scene            | home       | 11.5 KiB, only 02:00–07:00 and night |
| Keys list, switch, comment | every page | about 0.4 KB                         |
| Art                        | posts      | 0.5 to 4.3 KB                        |

**Budget allowances.** The budgets of ADR 0017 count the islands against 20 KB on pages with islands, and home sits at 20.0 KB (20,446 B), so the room script (1,542 B with the tzdata check and the shortcuts switch) needs its own allowance like the theme script's. The theme script also outgrows the 1 KB cap ADR 0017 gives it: the keys and their off switch take it from 685 B to 1,289 B (gzip level 9, as `scripts/budgets.ts` measures). It ships as written, comments included; minified (esbuild) it would be 726 B, but that needs a build step of its own. Each cap is the measured size plus about 10 %, so the next addition is a decision rather than a surprise. `scripts/budgets.json` has:

```json
{ "name": "room clock", "file": "/_astro/index.astro_astro_type_script_index_0_lang.*.js", "bytes": 1700 },
{ "name": "theme switch", "file": "/_astro/theme.*.js", "bytes": 1420 }
```

and ADR 0017's table has the row _Room clock, 1.7 KB gzip, home page only: the window, moon and lamp follow Rabat's clock, which needs the visitor's current time; no island is grown for it_, and the theme script's row is _1.4 KB gzip, on its own_, with "It is 1.3 KB: the theme switch, plus the keys of ADR 0027 and their off switch (WCAG 2.1.4)". With those allowances, `just budgets` passes on this build (home: 20,446 B of islands, 34 B under 20 KB; 2.8 KB allowed; 69.4 KB page weight, which now counts every image the stylesheet can load).

Lighthouse 12.6.1 mobile on home (simulated throttling, Playwright's Chromium, the fixtures-mode Worker, three runs): performance 0.99 to 1.00, accessibility 1.00, LCP 1.66 s in every run, TBT 0 ms, CLS 0.0004. That is the LCP ADR 0026 measured before these details; the room script loads as a module and the window layer is smaller than the scene, so neither is in front of it.

## What each detail falls back to

| Detail          | No JavaScript                                                                                                          | Reduced motion           | Failed or stale data                                                                           | Other time zone                                                       |
| --------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Window and moon | The theme's own window, no moon (the static night scene no longer draws a fixed crescent, which was wrong most nights) | No change: nothing moves | None needed: no data                                                                           | Uses Rabat's sun, not the visitor's                                   |
| Lamp and note   | Lamp as the theme draws it, no note                                                                                    | No change                | None needed                                                                                    | Uses Rabat's clock via tzdata; outdated tzdata: as without JavaScript |
| Record          | Rests                                                                                                                  | Rests                    | Rests: only a live answer with a track turns it, and only for 15 minutes after its `fetchedAt` | Not time-based                                                        |
| `curl`          | Not JavaScript                                                                                                         | n/a                      | n/a                                                                                            | n/a                                                                   |
| Keys            | Nothing opens; the switch and links work as before                                                                     | n/a                      | n/a                                                                                            | n/a                                                                   |
| Art             | Drawn at build time                                                                                                    | Static                   | n/a                                                                                            | n/a                                                                   |

## How to see each one

- Window, moon, lamp and note: open the home page; it shows Rabat now. For other hours, the e2e tests "the room keeps Rabat time" in `apps/site/e2e/room.spec.ts` fix the clock at 03:00, noon and dusk; Playwright's `page.clock.setFixedTime` does the same by hand.
- Record: only with a live `/v1/listening` answer. Locally, `signals.spec.ts` serves one from the shared fixtures.
- `curl -s http://localhost:8790/` after `just site-build` and `just site-serve`.
- Keys: press `?` on any page, or the footer's Keys button; `t`; `1` to `7` on home. The list's switch turns them all off.
- View-source note: view the source of any page.
- Art: `/writing/token-logs` (ascii), `/writing/ephemeral-runners` (dither), `/writing/cache-reads` (pattern).

## Consequences

- The home page runs a 1.5 KB module script; every other page is unchanged apart from 0.6 KB more theme script, the keys list with its switch, the Keys button and the comment.
- A device clock that is wrong shows a wrong sky, moon and lamp (accepted above).
- Moving the window in `scene.py` means moving the moon's centre (122, 25) in `room.ts`.
- Changing `art.ts` changes every post's art; the golden files make that a deliberate `vitest run -u`.
- Visitors with tzdata older than 2026c see the theme's lamp and no note until their browser updates.
- If Morocco changes its clocks again, `knowsRabatTime()` in `sky.ts` must follow the new rules, or every browser loses the lamp and the note.
- Every new single-key shortcut must check `data-shortcuts` on `<html>`, and show in the list.
