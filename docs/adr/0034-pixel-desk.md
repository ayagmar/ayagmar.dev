# 0034. Pixel Desk

Status: accepted, 2026-10-26. Amends ADR 0026 where it changes the room's visual system.

## Context

The owner found the site flat and generic under its one illustrated scene: panels were solid fills with stepped corners, one typeface voice at every size, and `/stats` read as a table of facts. Three prototypes were built over the real pages (`design-site-directions`); the one picked treats the page as the monitor on the desk: a small operating system, in the same pixel world as the room. This ADR records how it is built. The look is the prototype's; the code is not (the prototype was an overlay on built HTML).

## Decision

### Type

Pixelify Sans for the name, headings, navigation, buttons, the footer and big numbers, never for running text. Source Serif 4 still sets everything read; JetBrains Mono the data, dates and slugs. The pixel face is a variable font (400 to 700), OFL 1.1, subset by `just fonts` to the same characters as the others (10.5 KB woff2). Upstream publishes no releases; the build pins the last commit that touched the variable font (33f4b19, 2023-09-13) and its sha256, the same design as `@fontsource-variable/pixelify-sans` 5.3.0, the latest at the time. The subset drops `liga` and `calt`: Pixelify's "fi" ligature is a different shape and turned "file" into "Ale". `font-display: swap` as for the others (ADR 0026), and it is preloaded on every page next to the serif roman, because the name on home is set in it and a late swap would move the page. Home therefore loads three fonts (`e2e/room.spec.ts` checks which). Fonts are 124 of 200 KB.

H1s are lowercase and end in a blinking underscore (CSS content, so it is not read). A post's title keeps its case and gets the hard shadow.

### Palette

The tokens in `base.css` change; every colour is still a `light-dark()` pair. Night: ground `#07060f`, window chrome `#5a4fd6`, amber `#ffb21f`, phosphor mint `#4dffb0`, rose `#ff7592`, cyan `#5ad7ff`. Day: warm paper `#f0e4c8` with ink-purple chrome (`#2a2144`) and deep green and amber bars. A window's material still names its colour: the green screen for projects, violet for listening, amber for shipping, blue for LLM usage, brown for the shelf, red for writing.

### Windows

`.panel` and `.paper` are windows: a 3 px border, a 1.9 rem title bar holding a file name (`projects.json`, `listening.app`, `shipping.log`, `llm-usage.db`, `shelf.md`, `writing.md`; a page may set its own with `--title`), three pixel buttons and a hard 7 px offset shadow with no blur. The file name and the buttons are CSS `content` and `::after`, so assistive technology does not read them; the window's own heading is the label. The CRT windows (green, violet, blue) carry scanlines, and the whole page a faint 4 px one. The popover Menu and the dialogs use the same border and shadow. The stepped `clip-path` corners are gone everywhere; the perforated notebook edge is gone with them.

**Contrast.** The prototype set title-bar text in near-black, which was 3.4:1 on the violet and 3.8:1 on the green bar. Bars now carry cream (`--bar-text`) on bars chosen for it: night violet `#5a4fd6` 4.97:1, green `#176b4e` 5.39:1, amber `#8a5410` 5.22:1, blue `#1f6a96` 4.92:1, brown `#8a5a3a` 4.86:1, red `#a83a30` 5.29:1; by day every bar is at least 6.4:1. The status bar (the footer) is the line colour with the same text. Window text, amber and mint links and the muted text were computed on every window surface in both themes and are all at least 4.5:1; axe checks them as before.

### Shipping, alive

The list is a git graph: a dashed rail, a square node per event, the newest amber and blinking, each time in phosphor. Above it a heat strip of the last 28 UTC days, one cell a day, drawn from the events already in the snapshot (`heatLevels` in `src/data/format.ts`: levels 0 to 4 by events a day, computed at build against the build's time, so it adds no request and no script). It is one `role="img"` with a text label; its caption, "28 days ago" and "today", is real text. Times keep the build-time date, not a relative phrase: a relative time written at build goes stale until the next build.

### Posts

Every post and TIL note starts with a server-rendered file bar: `~/writing/<slug>.md` and `<n> min read`, from the Markdown's word count at 220 a minute (`readingMinutes`). Search leaves it out.

### Other pages

The 404 is a "file not found" dialog (an `error.txt` window) with a link home. Big numbers on `/stats` are set in the pixel face with a hard shadow.

### Motion

`steps()` only: the cursor and the newest node and status dot blink, the record turns in 36 steps and the lamp comes on in 9. Under `prefers-reduced-motion` the existing global rule stops all of it. No sound. The proposed delights that need script or more markup (command-line search, the Konami rain, collapsing windows) are not built.

### Overcast

A code-3 sky (ADR 0029) has its own layer, `weather-overcast-{day,night}.png`, drawn by `scripts/scene.py` in the room's 41 colours (1.4 and 1.8 KB). Code 2 keeps the puffs. The brief also named cloud cover of 100 as a trigger; it is not one, because the room script has 1 B of headroom under its 2,300 B cap (ADR 0017) and a code 2 answer with a full cover reading is rare.

## Consequences

- Fonts +11 KB (124 of 200 KB), CSS about +2.5 KB gzip, home page weight and JavaScript unchanged apart from 4 B in the room clock for the new state name.
- Home loads one more font than before, preloaded; Lighthouse for the pages is in the pull request.
- Every window needs a file name; a new panel material needs a bar colour chosen for 4.5:1 with `--bar-text` in both themes.
- Pixelify at body size is tiring, so the rule "never running text" is the one to hold in review.
