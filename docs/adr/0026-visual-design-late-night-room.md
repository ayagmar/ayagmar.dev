# 0026. Visual design: the late-night room

Status: accepted, 2026-10-26

## Context

The owner picked the "late-night room" prototype: the home page is a dithered pixel-art desk in Morocco, every object on it leads to a section, and the same content runs underneath as panels, each in its object's material. They also asked for a day and a night version. Until now the site had a plain base stylesheet.

The design has to keep what earlier ADRs promise: a strict CSP with no new inline scripts or styles (ADR 0019), no external origins, axe-clean pages, no sideways scroll at 320 px and touch targets of at least 24 px (foundation plan, mobile amendment), and the Lighthouse budgets of the in-flight Lighthouse PR (ADR 0017): page weight at most 150 KB gzip without fonts, fonts at most 200 KB, performance 0.95 and accessibility 1.0 on mobile.

## Decision

### Tokens

`apps/site/src/styles/base.css` holds one token layer. Every color is a `light-dark(day, night)` pair, so a theme is one switch: `color-scheme` on `<html>`.
- Night: indigo-black ground `#0c0b14`, amber lamp `#f2b457` for links and dates, mint screen glow `#7fe0b4` for projects, cream text.
- Day: the same room in daylight, not an inversion. Warm sunlit wall `#ece2cf`, dark ink text, the lamp darkened to `#7f4100` and the glow to `#155a46` so both stay above 4.5:1 on every day surface.
- Writing sits on paper (`--paper`, `--ink`): lamp-lit cream at night, brighter cream by day, ink the same in both. The paper has a perforated left edge.
- Panel materials: screen (projects), vinyl (music), cork (shipping), wood (shelf), tea (about), frame (LLM usage), each a `light-dark()` pair. A surface sets four variables (`--bg`, `--fg`, `--fg-2`, `--accent`) and everything inside draws with them.
- Panels have stepped pixel corners (`clip-path`).

`room.css` holds only the home page: the scene, hotspots, the list and the home panels.

Contrast is checked by axe in both themes (below), not by hand.

### Theme switch, and why it costs one script

The page follows `prefers-color-scheme` until the reader picks Day or Night in the header switch; Auto forgets the choice. The choice is kept in `localStorage` under `theme`.

Applying a stored choice before the first paint needs code that runs while `<head>` is parsed. CSS alone cannot read storage, and a deferred or module script runs after the first paint, which flashes the system theme first. So `apps/site/src/scripts/theme.js` is a classic blocking script in `<head>`. It is a same-origin file, so the CSP is unchanged: `script-src 'self'` covers it and postbuild sees no new inline script. It is imported with `?url&no-inline`, which makes Vite emit it as a hashed file under `/_astro/` (cached for a year) instead of inlining a small file as a `data:` URL the CSP would block. It is about 0.7 KB gzip. It sets `data-theme` on `<html>` (or removes it for Auto), sets `aria-pressed` on the switch buttons, and listens for clicks on them. Storage access is wrapped because browsers that block storage throw; the page then follows the system theme.

Without JavaScript the switch stays hidden (CSS shows it only once the script set `data-theme-switch`) and the page renders in the system theme.

Lighthouse budget: the Lighthouse PR (ADR 0017) plans a "0 JS on pages without islands" budget. Every page already has the search island, and this script adds one named file, `theme.*.js`, of under 1 KB gzip on every page. When ADR 0017 lands, its budgets config needs an explicit allowance for that file, justified by the flash it prevents.

### Type

Source Serif 4 for everything read, JetBrains Mono for data (dates, counts, the `min7` wordmark, code). Both are self-hosted WOFF2, built by `apps/site/scripts/fonts.py` (`just fonts`, needs `uv`) from the upstream releases (Source Serif 4.005R, JetBrains Mono 2.304), each checked against a sha256:
- Subset to Basic Latin, Latin-1, and the typographic punctuation and arrows the site uses.
- Weights cut to 400 to 700. Both serif faces are pinned to the text optical size (`opsz` 16). Keeping the axis gave headings Source Serif's display cut, but it made the roman 101 KiB, and that preloaded file pushed mobile LCP on home past 2 s. The price: no automatic optical sizing, so large headings use the text cut, which is a little heavier and looser than the display cut.
- `font-display: swap`; only the roman is preloaded.
- Sizes: roman 43 KiB, italic 42 KiB, mono 28 KiB, 113 KiB in total.
- Home sets no italic text (the room list's section names are muted roman, the playing track is semibold), so it loads only the roman and the mono. An italic on home puts the italic font in front of the scene, which cost about 0.15 to 0.3 s of mobile LCP in Lighthouse. `e2e/room.spec.ts` fails if home loads a third font.
- "Source" is a Reserved Font Name under the OFL and a subset counts as a modified version, so the serif files and the CSS name the family "min7 Serif". The licenses are next to the files in `src/fonts/`.

Posts get the largest type on the site: 18 to 21 px body at a 66ch measure, 32 to 52 px titles.

### The scene

`apps/site/scripts/scene.py` (`just scene`, needs `uv`; Pillow 13.0.0) draws the room as two 480x160 PNGs into `src/assets/`: `room-night.png` (12 KiB, lamp, monitor and fairy lights lit) and `room-day.png` (10 KiB, sun through the window, lamp and fairy lights off, whitewashed rooftops). Both are geometry plus an 8x8 Bayer dither onto a fixed palette; no photos or portraits. Outputs are committed; CI does not run Python.

The scene is drawn as two CSS backgrounds, one per theme, on `role="img"` elements with their own text alternatives. Only the shown one downloads, and switching needs no script. The text alternative describes the room's light and view, not the objects the list already names.

The scene is home's LCP element on phones. Lighthouse 13.5 mobile (simulated throttling, Playwright's Chromium, the fixtures-mode Worker), median of three runs per theme:

| Change                                     | Day LCP | Night LCP |
| ------------------------------------------ | ------: | --------: |
| Roman with the optical size axis (one run) |  2.26 s |    2.26 s |
| Roman pinned to `opsz` 16                  |  1.81 s |    1.96 s |
| Pinned, and no italic on home              |  1.66 s |    1.66 s |

Performance 0.99 to 1.00, accessibility 1.00, CLS under 0.001 in the last row. A high-priority preload of the shown scene, started by the theme script, was tried and left out: once the italic was gone, runs with and without it differed by less than the run-to-run spread (about 0.15 s).

Seven hotspots are real links in reading order (left to right): corkboard (shipping), framed screen (LLM usage), notebook (writing), monitor (projects), tea set (about), record player (music), shelf (reading). `apps/site/src/lib/room.ts` lists them once, and both the hotspots and the plain list under the scene render from it. Their rectangles are percentages in `room.css`, keyed by `data-room`. Each hotspot is at least 32 scene pixels on both sides, so it is at least 24 CSS px from a 360 px viewport up; below 360 px the hotspots are hidden and the list is the way in. The scene scales to the viewport width at every size.

The only motion is the lamp coming on (a 1.8 s brightness fade, night only) and the record turning in the listening panel. `prefers-reduced-motion: reduce` sets `animation: none` on everything.

### Pages

Writing index, posts, tags, colophon and 404 are paper sheets. Projects and project headers are screens; a project's own description is on paper. About is a tea panel (name, summary, resume button) over a paper sheet with experience, certifications, education and skills. Stats is a grid of panels, one material per source. The search dialog uses the room's surface and line colors.

### Diagrams

Pele diagrams keep the class rewrite of ADR 0024; only the `--pele-*` variables changed. They take the paper's colors, which differ by time of day. Charts draw with `--pele-series-1` to `--pele-series-6`, also set from the paper tokens; the first series is the paper's accent. A seventh series would show Pele's own palette. Pele still measures labels for `system-ui, sans-serif`, so the diagram font stays that.

### Hooks for the next design PR

- Scene objects carry `data-room="<id>"`, and the list's links `data-room-list="<id>"`.
- `PostHeader.astro` has an `art` slot, rendered as `figure.post-art` above the title only when given.

No easter eggs and no per-post art yet.

### Lint

Biome's `noDescendingSpecificity` is off for `apps/site/src/styles/**`. It compares selectors that never match the same element (header links against post-list links), and satisfying it would scatter each component's rules across the file.

### Rejected from the prototype

- The 760 px wide scene with drag-to-scroll on phones: it hid most of the room and forced a gesture. The scene now scales to the viewport, and the list carries narrow phones.
- The live Casablanca clock on the desk and the heatmap built in the browser: they needed page JavaScript. The clock may come back with the easter eggs.
- Sample LLM usage and shelf panels with made-up numbers: those sources are not wired, so the home page shows only real panels and their hotspots lead to the stats sections that say "No data yet".
- Hotspot targets inside the home page (`#writing`): they now go to the real pages.

## Consequences

- One blocking script of under 1 KB on every page; ADR 0017's budget needs a named allowance for it.
- `light-dark()` needs Chrome 123, Safari 17.5 or Firefox 120. Older browsers get no colors from the tokens.
- Changing the scene means editing `scene.py` and, if an object moves, its rectangle in `room.css`.
- The home page weighs about 42 KB gzip without fonts (HTML, CSS, the island runtime, the theme script and one scene).
