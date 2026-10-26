# 0034. Lit windows

Status: accepted, 2026-10-26. Amends ADR 0026 where it changes the room's visual system, and ADR 0029 (overcast).

## Context

The owner found the site flat and generic under its one illustrated scene: panels were solid fills with stepped corners, one typeface voice at every size, and `/stats` read as a table of facts. Three prototypes were built over the real pages. The owner first picked "Pixel Desk" (windows, a pixel typeface, scanlines), then saw it on a Preview and found the pixel face hard to read and mushy. The approved direction is a hybrid of "Lamplight" (a lit room, a soft serif display face) and Pixel Desk's windows. This ADR records the build; the prototypes were overlays on built HTML and none of their code is reused.

## Decision

### Type

Fraunces for the name, headings, post titles and big numbers. Source Serif 4 still sets everything read; JetBrains Mono the data, dates, slugs, window title bars, buttons and the footer. No pixel face anywhere, no text-shadow on text, no glow, no scanlines, no lowercased headings.

Fraunces is a variable font (OFL 1.1, no Reserved Font Name) with four axes. The build keeps none: the subset is one static cut, weight 750, the soft form (`SOFT` 100), the wonky glyphs (`WONK` 1) and an optical size of 48, which reads well from 1.2 rem sub-headings to a 3.8 rem title. Every display use is that weight. `just fonts` fetches the TTF, checks its sha256, subsets it to what a heading needs (ASCII, Latin-1 letters and the typographic punctuation, with kerning and ligatures but not the text faces' small caps and figure styles) and writes `display.woff2`: 14.3 KB. The first cut, a weight axis from 600 to 800 and the whole Latin-1 set, was 30.8 KB and put mobile home LCP at 1.96 s against ADR 0017's 2.0 s; this one measures 1.81 s. The latest tagged release (1.000, October 2020) predates the variable font, so the build pins upstream's latest commit (7ccdec3, 2025-10-21, font version 1.003); `@fontsource-variable/fraunces` 5.3.0 is the same family. `font-display: swap` as for the others (ADR 0026). It is not preloaded: a preload of it and the mono moved mobile LCP on /projects, /about and /uses from about 1.4 s to 1.7 s in CI (ADR 0017 flags one simulated round trip, 150 ms, as the limit of noise). What a swap would shift is handled by a fallback face instead: while the display face loads, headings are set in the serif roman (already downloaded, the same file) scaled to 101.4% of its width and given Fraunces' ascent and descent, so the swap moves nothing (CLS 0.0004 to 0.0009 on every page). The one preload is the mono on /stats: the fixtures banner there is a wrapped line of mono, which rewrapped when the font swapped in (CLS 0.16 against the 0.01 budget). Home loads three fonts (`e2e/room.spec.ts` checks which).

**Font budget (ADR 0017).** 127.4 of 200 KB for the whole build, up from 113 KB: the display face adds 14.3 KB. Home loads the serif roman, the mono and the display face, 87 KB.

### Palette and light

Lamplight's palette: night ground aubergine `#0d0a17`, amber lamp `#ffb54a`, mint `#6ee7b0`, rose `#ff8e7c`, cream text `#f6ead2`; day is a sunlit plaster wall `#efe3cb` with the lamp darkened to `#7a3a00`, the mint to `#0b4f3c` and the muted text to `#4a3f4d`. The page has a warm pool of light at the top right and a faint mint one at the left; a post sits under the lamp's pool, centred. Colour comes from lit surfaces, not glow.

### Windows

`.panel` and `.paper` are windows, as in the Pixel Desk build: a 3 px border in the window's colour, a crisp title bar with a file name in mono (`projects.json`, `listening.app`, `shipping.log`, `llm-usage.db`, `shelf.md`, `writing.md`; a page may set its own with `--title`, or `data-file` as `/uses` does), three small square buttons, and a hard 7 px offset shadow with no blur. The file name and the buttons are CSS content, so assistive technology does not read them; the window's own heading is the label. Inside, the panel is lit from its top left corner and falls off to its bottom right in its object's colour (`--screen`/`-hi`/`-lo`, and so on: green for projects, violet for listening, amber for shipping, blue for LLM usage, brown for the shelf, a sage for about, aubergine for writing). The popover Menu and the dialogs share the chrome. The stepped `clip-path` corners are gone.

**Contrast.** Title-bar text is cream (`--bar-text`) on bars chosen for it: night violet `#5a4fd6` 4.97:1, green `#176b4e` 5.39:1, amber `#8a5410` 5.22:1, blue `#1f6a96` 4.92:1, brown `#8a5a3a` 4.86:1, red `#a83a30` 5.29:1; by day every bar is at least 6.4:1. The footer is a status bar in the chrome colour with the same text. Text on a lit panel was computed at all three stops of its gradient (axe cannot read a gradient), in both themes: body text at least 8.3:1 at night and 10:1 by day, muted text at least 4.8:1 and 6.0:1, links and mint at least 5.7:1 and 5.2:1. The day gradients are kept shallow for this reason.

### Shipping, alive

The list is a git graph: a dashed rail, a square node per event, the newest amber and blinking, each time in mint. Above it a heat strip of the last 28 UTC days, one cell a day in the lamp's amber, drawn from the events already in the snapshot (`heatLevels` in `src/data/format.ts`: levels 0 to 4 by events a day, computed at build against the build's time, so it adds no request and no script). It is one `role="img"` with a text label; its caption, "28 days ago" and "today", is real text. On /stats the strip sits above the list and is drawn once with the page; the script that keeps the list current (ADR 0015) redraws only the list. Times are the relative ones the live pages already keep (ADR 0015), in mint.

### Sample data

In fixtures mode (ADR 0015) every panel's "Sample data, not live" line is a solid rose tag in mono capitals, and /stats opens with a hatched rose banner inside a rose border. Rose is the colour of what is not real; the text on both is at least 5.2:1.

### Posts and other pages

Every post and TIL note starts with a server-rendered file bar: `~/writing/<slug>.md` and `<n> min read`, from the Markdown's word count at 220 a minute (`readingMinutes`). Search leaves it out. The 404 is a "file not found" dialog (an `error.txt` window) with a link home. The /skills shelf cards are small windows. Big numbers on `/stats` are Fraunces in the lamp's colour.

### Motion

`steps()` only: the newest shipping node and the status-bar dot blink, the record turns in 36 steps and the lamp comes on in 9. Under `prefers-reduced-motion` the existing global rule stops all of it. No sound. The proposed delights that need script or more markup (command-line search, the Konami rain, collapsing windows) are not built.

### Overcast

A code-3 sky (ADR 0029) has its own layer, `weather-overcast-{day,night}.png`, drawn by `scripts/scene.py` in the room's 41 colours (1.4 and 1.8 KB). Code 2 keeps the puffs. The brief also named cloud cover of 100 as a trigger; it is not one, because the room script has 1 B of headroom under its 2,300 B cap (ADR 0017) and a code 2 answer with a full cover reading is rare.

## Consequences

- Fonts +14 KB (127 of 200 KB); the source CSS about +1.6 KB gzip; home JavaScript unchanged apart from 4 B in the room clock for the new weather state, 2,299 of 2,300 B.
- Home loads one more font than before.
- Every window needs a file name, and a new panel material needs a bar colour chosen for 4.5:1 with `--bar-text` and three gradient stops checked in both themes.
- Fraunces is for display only; running text stays in Source Serif 4.
