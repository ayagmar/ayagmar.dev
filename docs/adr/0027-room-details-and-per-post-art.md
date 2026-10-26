# 0027. Room details and per-post art

Status: accepted, 2026-10-26

## Context

ADR 0026 left the room static and the post page's `art` slot empty. The owner asked for six details, and nothing more:
1. The window shows the real moon phase, and its sky follows the real sun over Casablanca: day, dusk, night. The page theme's Auto stays on `prefers-color-scheme`; the window is the room's clock, not the visitor's.
2. The record turns only when Last.fm says something is playing now.
3. Between 02:00 and 07:00 Casablanca time the lamp dims and a small "probably asleep" note appears.
4. `curl ayagmar.dev` prints the room as ASCII art above the text index.
5. A `?` list of keyboard shortcuts (search, theme, the room's objects) and a short note for people who read the page source.
6. Optional per-post art from frontmatter, drawn at build time from the room's palette, with no JavaScript.

Every detail has to keep what ADRs 0019, 0026 and the budgets of ADR 0017 promise: a strict CSP, no other origins, axe-clean pages in both themes, no layout shift, and no new JavaScript on pages that do not need it. Each one must also degrade to a correct static room: without JavaScript, with reduced motion, with a failed or stale now-playing answer, and for a visitor in another time zone.

## Decision

### The room's clock: window, moon, lamp

`apps/site/src/lib/sky.ts` computes everything from an instant, with no state. `apps/site/src/scripts/room.ts` runs it on the home page only, once on load and then every minute, and sets three things on `.scene`:
- `data-sky` is `day`, `dusk` or `night`. `room.css` then shows one of three window layers, `window-{day,dusk,night}.png`. Each is the full 480x160 scene, transparent except the view through the window, so it lines up with the scene at any size. The window frame, the mullions and the lamp in front stay in the room's own scene, so they keep the room's light. Only the layer in use downloads (1.3 to 1.4 KiB each).
- The moon is an inline SVG over the scene in the same 480x160 coordinates. The script writes its `path`: the lit part of a 12-pixel disc, a run of unit squares per row, lit on the right while waxing as seen from Morocco, in the palette's moon colour `#e8e8fa`. It is drawn at dusk and at night, and left out when less than 3 % is lit.
- `data-late` between 02:00 and 07:00 Casablanca time swaps the night scene for `room-night-dim.png` (the lamp at a third of its light, the bulb a dim amber) and shows the note `Probably asleep: it is 03:12 in Casablanca.` The note sits over the desk's front edge, below every hotspot, positioned absolutely, so showing it moves nothing. In the day theme the lamp is already off; only the note appears.

The window element gets `role="img"` and a label such as "Through the window: night over Casablanca, a waxing gibbous moon." from the script. The room's own text alternatives no longer mention the sky.

Day is when the sun's centre is above −0.833° (NOAA's sunrise and sunset), dusk is civil twilight (down to −6°), night is below that. Dawn uses the dusk sky. The moon's position in the sky is not modelled: at night the window shows the phase, whether or not the moon has risen.

`scripts/scene.py` (`just scene`) draws the three window layers and the dim room next to the two scenes. It records which pixels are the view while it draws the sky and skyline; anything drawn later (the mullions, the lamp) clears them, and only the remaining view goes into a layer.

**Sources.**
- Sun: the NOAA Solar Calculator's own equations, from its code (`calcSunDeclination`, `calcEquationOfTime`, `calcAzEl` in https://gml.noaa.gov/grad/solcalc/main.js, read 2026-10-26), which follow Meeus. The terms in t² and t³ are left out: this century they move the sun by under 0.0001°.
- Moon: Meeus, _Astronomical Algorithms_, 2nd edition (Willmann-Bell, 1998): the mean elongation D and the anomalies M and M′ of chapter 47, and the phase angle i of formula 48.4 with its six periodic terms. The illuminated fraction is (1 + cos i) / 2. A named phase (new, first quarter, full, last quarter) is shown within about half a day of its instant (6.1° of elongation); the in-between names otherwise. Chapter 49's phase instants are not needed: the elongation gives the phase at any instant directly.
- Time: `Intl.DateTimeFormat` with `timeZone: 'Africa/Casablanca'`, which reads the browser's IANA tzdata. No offset is written down anywhere.

**Why tzdata matters here.** Morocco ran at +01 with a change to +00 for Ramadan each year until 2026. The tzdata `africa` file (release 2026c) records Decree 2.26.530: Morocco moved to +00 for good on 2026-09-20 at 02:00, with no further clock changes. So there are no 2027 Ramadan changes to test around; the tests use the three 2026 changes (15 Feb, 22 Mar, 20 Sep). A hand-written +01 would now be an hour wrong every day. A browser whose tzdata predates 2026c still thinks Morocco is at +01, so for it the lamp and the note are an hour late. That fixes itself as browsers update ICU; the sky and the moon do not depend on the offset at all.

**Checks** (`apps/site/test/sky.test.ts`):
- Moon: the illuminated fraction on 12 dates in 2026 is within 3 points of NASA SVS Dial-A-Moon (https://svs.gsfc.nasa.gov/api/dialamoon/, JPL ephemeris; it measured within 0.25 points). The named phase at 12 instants over 2026 and 2027 from Espenak's catalogue (https://eclipse.gsfc.nasa.gov/phase/phases2001.html) matches, and the elongation is within one day's motion of the phase (it measured within 0.6 hours). The USNO API and timeanddate.com refused connections from the build machine, so these two sources stand in for them.
- Sun: sunrise and sunset on 8 dates, both sides of each 2026 clock change plus both solstices, are within 2 minutes of NOAA's calculator in Casablanca local time (they measured within 1 minute).
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

The three placeholder posts carry one kind each, so e2e and axe see all three in both themes.

### The CSP and the build

The room script is imported from an Astro `<script>`, emitted as `/_astro/index.astro_astro_type_script_index_0_lang.<hash>.js`. Astro inlines a script smaller than Vite's `assetsInlineLimit`, which the CSP would block, so `astro.config.ts` sets the limit to 0: nothing is ever inlined. Inline `data:` assets were already blocked by `img-src 'self'`, so no output changes otherwise. The moon is drawn by setting an SVG attribute, which `style-src` does not cover.

### Cost

| What                       | Where      | Size (gzip)                          |
| -------------------------- | ---------- | ------------------------------------ |
| Room script (`room.ts`)    | home only  | 1,531 B                              |
| Theme script (`theme.js`)  | every page | 1,289 B (was 685 B)                  |
| Now-playing island         | home       | +156 B                               |
| Window layer               | home       | 1.3 to 1.4 KiB, one per visit        |
| Dim night scene            | home       | 11.5 KiB, only 02:00–07:00 and night |
| Keys list, switch, comment | every page | about 0.4 KB                         |
| Art                        | posts      | 0.5 to 4.3 KB                        |

**Budget allowances.** The budgets of ADR 0017 (pull request #11, not merged yet) count the islands against 20 KB on pages with islands, and home sits at 20.0 KB (20,446 B), so the room script needs its own allowance like the theme script's. The theme script also outgrows the 1 KB cap ADR 0017 gives it: the keys and their off switch take it from 685 B to 1,289 B (gzip level 9, as `scripts/budgets.ts` measures). It ships as written, comments included; minifying it would win back about a third, but needs its own build step. Each cap is the measured size plus about 10 %, so the next addition is a decision rather than a surprise. When ADR 0017 lands, `scripts/budgets.json` gets:

```json
{ "name": "room clock", "file": "/_astro/index.astro_astro_type_script_index_0_lang.*.js", "bytes": 1536 },
{ "name": "theme switch", "file": "/_astro/theme.*.js", "bytes": 1420 }
```

and its table gets the row _Room clock, 1.5 KB gzip, home page only: the window, moon and lamp follow Casablanca's clock, which needs the visitor's current time; no island is grown for it_, and the theme script's row becomes _1.4 KB gzip, on its own_, with "It is 1.3 KB: the theme switch, plus the keys of ADR 0027 and their off switch (WCAG 2.1.4)". With those allowances, #11's `scripts/budgets.ts` passes on this build (home: 20,446 B of islands, 34 B under 20 KB; 2.8 KB allowed; 70.9 KB page weight, which now counts every image the stylesheet can load).

Lighthouse 12.6.1 mobile on home (simulated throttling, Playwright's Chromium, the fixtures-mode Worker, three runs): performance 0.99 to 1.00, accessibility 1.00, LCP 1.66 s in every run, TBT 0 ms, CLS 0.0004. That is the LCP ADR 0026 measured before these details; the room script loads as a module and the window layer is smaller than the scene, so neither is in front of it.

## What each detail falls back to

| Detail          | No JavaScript                                                                                                          | Reduced motion           | Failed or stale data                                                                           | Other time zone                          |
| --------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Window and moon | The theme's own window, no moon (the static night scene no longer draws a fixed crescent, which was wrong most nights) | No change: nothing moves | None needed: no data                                                                           | Uses Casablanca's sun, not the visitor's |
| Lamp and note   | Lamp as the theme draws it, no note                                                                                    | No change                | None needed                                                                                    | Uses Casablanca's clock via tzdata       |
| Record          | Rests                                                                                                                  | Rests                    | Rests: only a live answer with a track turns it, and only for 15 minutes after its `fetchedAt` | Not time-based                           |
| `curl`          | Not JavaScript                                                                                                         | n/a                      | n/a                                                                                            | n/a                                      |
| Keys            | Nothing opens; the switch and links work as before                                                                     | n/a                      | n/a                                                                                            | n/a                                      |
| Art             | Drawn at build time                                                                                                    | Static                   | n/a                                                                                            | n/a                                      |

## How to see each one

- Window, moon, lamp and note: open the home page; it shows Casablanca now. For other hours, the e2e tests "the room keeps Casablanca time" in `apps/site/e2e/room.spec.ts` fix the clock at 03:00, noon and dusk; Playwright's `page.clock.setFixedTime` does the same by hand.
- Record: only with a live `/v1/listening` answer. Locally, `signals.spec.ts` serves one from the shared fixtures.
- `curl -s http://localhost:8790/` after `just site-build` and `just site-serve`.
- Keys: press `?` on any page, or the footer's Keys button; `t`; `1` to `7` on home. The list's switch turns them all off.
- View-source note: view the source of any page.
- Art: `/writing/token-logs` (ascii), `/writing/ephemeral-runners` (dither), `/writing/cache-reads` (pattern).

## Consequences

- The home page runs a 1.5 KB module script; every other page is unchanged apart from about 0.3 KB of theme script, the keys list and the comment.
- Moving the window in `scene.py` means moving the moon's centre (122, 25) in `room.ts`.
- Changing `art.ts` changes every post's art; the golden files make that a deliberate `vitest run -u`.
- Visitors with tzdata older than 2026c see the lamp go down an hour late until their browser updates.
- Every new single-key shortcut must check `data-shortcuts` on `<html>`, and show in the list.
