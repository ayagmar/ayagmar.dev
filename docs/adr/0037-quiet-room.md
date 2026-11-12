# 0037. The quiet room

Status: accepted, 2026-11-01. Amended 2026-11-12: a project's header holds its install command and one line of links, and the page ends on its releases feed and the next project (ADR 0050). Amended 2026-11-06: a post's figure in dots is the one other picture, and has no plate, so no corners or outline (ADR 0027). Amended 2026-11-06: a page change fades in 160 ms (ADR 0042); every heat view shares one level function and one ramp, and keeps no record apart from zero; home's list steps back on a wide screen; a post ends in small print; home has an entrance once per session. Amended 2026-11-11: on a wide screen each row of home's list shows its object under the section name, and an object under the pointer or focus lights its row as a row lights its object; under the name, the summary from /about with links to email, GitHub and /about replaces the role, and the entrance brings in the name, that pitch with its links, and the list. Amended 2026-11-12: certification badges on /about and plugin thumbnails on /projects are pictures too, below the fold (ADR 0048). Amended 2026-11-12: a project page shows a screenshot of the project under its header (ADR 0049). Supersedes ADR 0034's windows, type and palette. Amends ADR 0026 (visual system) and ADR 0017 (font budget). Amended 2026-11-12: below 60 rem each row says what its page holds instead of naming the object; from 60 rem the hotspots leave the Tab order and each row carries its hotspot's fact for screen readers; a project row is one link over the whole row (ADR 0051).

## Context

After the quiet windows (ADR 0034) the owner still found the site cartoony and generic. A critique of every page named the window chrome on every block, Fraunces' soft heavy cut, mono used for labels and buttons, seven hues with no meaning, murky gradients, dense underlines and a boxed header. Two options were built on real pages: A, "quiet room", where the room is the only picture and the rest is editorial; and B, "instrument panel", flat panels in a mono interface under the room. The owner chose A. One idea came over from B, the aligned time column in logs. The details pass follows Jakub Krehel's "Details that make interfaces feel better" (jakub.kr/writing).

## Decision

**The room is the only picture.** Everything under it is type, hairlines and space. `.panel` and `.paper` are sections, not boxes: a 1 px `--rule` above, the heading, and room around it. No title bars, file names, coloured squares, fills or gradients. The section that holds a page's title has no rule. The material classes (`m-screen` and the rest) only name the room's object a section belongs to.

**One reading column.** Every page but home and /stats reads in one centred column, `--column` (42 rem, about 70 characters of the 17 px serif), the same axis as a post: /writing, /til, a post, /projects, a project, /skills, /uses, /now, /about, /colophon and the 404. Lists in it are quiet rows on hairlines with a muted label on the right: a post's date, a project's post count and status, a skill's version, what a tool on /uses is. A short page keeps its footer at the bottom of the window (the body is a flex column).

**A post ends quietly.** Reply by email, Comments and the project block are small print in the muted colour, under headings at the size of the text, so nothing after the last paragraph outweighs it.

**Logs have a time column.** Shipping events and recent tracks are one `.log`: the time in a fixed 7.5 rem column of muted mono on the left, the event or track beside it; under 30 rem the time sits over its row. The time comes first in the markup (`src/lib/stats-panels.ts`, `src/lib/listening-panel.ts`), so the build and a live answer draw the same row.

**Type.** Source Serif at 600 for headings, at four sizes for the whole site: the page title (2 to 2.75 rem, the same for a post), a section heading (1.375 rem), the text, and small print. JetBrains Mono only for data: dates, times, counts, versions, repository names and code. Labels, buttons, captions, tags, the table of contents and the footer are the serif. Fraunces is gone, and its file and `just fonts` entry with it; home loads two fonts, the serif roman and the mono, both preloaded (`e2e/room.spec.ts`). A post's file bar (`~/writing/<slug>.md`) is gone; its reading time is in the post's meta line.

**One accent.** Links, the current page and the heat strip are the lamp. Rose marks sample data, as a dot and a line. The ground is flat: paper white `#f6f2ea` by day, ink `#0e0c13` at night; only a post or a note page (`/til/<slug>`) keeps the lamp's pool behind its title; the /til list does not.

**Heat is quantiles on one ramp.** The strip, a year's calendar and the LLM usage year take their levels from `heatLevels` (`src/lib/heat.ts`): null for a day with no record, 0 for a recorded zero, then the quartile of the non-zero days shown, equal counts together. Every view keeps those first two apart, the LLM usage year included: a date its snapshot does not hold is unknown, not a quiet day. The 28-day strip outlines such a day (ADR 0038); the year views, which are mostly such days, draw it fainter than a zero and say so in the caption. A fixed scale put most days of a real month on one pale step. The ramp is `--heat-1` to `--heat-4` in `base.css`, OKLCH steps of lightness on the lamp's hue. It stops well short of the lamp: at night the top is 7.5:1 on the ground where the old one was about 15:1, so a busy day no longer outshines the room. Each step stays 3:1 on the ground and 1.3:1 from the last (`e2e/contrast.spec.ts`).

**Home has one way round, not three.** The top nav, the hotspots and the list repeated each other. From 60 rem the list is one muted row of section names, with the object's name kept for screen readers, and hovering or focusing a row lights its object: the same state as the hotspot's own hover, label included, by `:has()` in `room.css`, with no script. Hotspots and rows both render `roomObjects`; CSS has no loop, so the rule names each id, and `e2e/room.spec.ts` walks every row so a new object cannot be left dark. Below 60 rem the list stays as it was, since on a phone it is the way in.

**Header and footer as words.** Search, Menu and the theme switch have no borders; the current page and the chosen theme are text over a 1 px lamp underline. The footer is one muted serif line.

**Details.**

- `-webkit-font-smoothing: antialiased` on the whole page.
- `text-wrap: balance` on headings, `text-wrap: pretty` on paragraphs, list items and definitions.
- `tabular-nums` on every time, number and data cell, so a ticking "3 minutes ago" or a column of counts does not shift.
- Concentric corners: controls (inputs, buttons, `kbd`, inline code) take `--radius` (4 px); the dialogs and the Menu popover, with 1 rem of padding, take `--radius` plus 1 rem, so a Close button or the search field in a corner sits concentric with it. Code blocks take twice `--radius`, and square corners where they run to a phone's edge.
- Images in posts have a 1 px outline in the text colour at 10%, so they hold their edge on either ground.
- Hover changes colour with a 120 ms transition, never a keyframe animation, so it stays interruptible. The transition applies only while hovered, so a change of theme recolours the page in one frame. The dialogs and the Menu open without animation. The one authored entrance is home's, below. The reduced-motion rule takes every transition and animation to nothing.

**The entrance.** The lamp's switch-on is the site's best moment, so on the first page of a session, if that page is home, the name, the role and the list follow it in, 80 ms apart from 0.4 s, by opacity and 6 px of `translate`. It runs behind the lamp, ends before it, and never touches layout. It takes `theme.js` to 1,409 B of its 1,420 B allowance, so the next addition there needs a new cap. `theme.js` sets `data-entrance` before the first paint, so without scripts or with blocked storage nothing is hidden and nothing plays. It sets it only under `prefers-reduced-motion: no-preference`, and takes it off when the list's animation ends, when any animation is cancelled and on `pagehide`: left on, turning reduced motion on and off again would replay the entrance, and so would a page restored from the back/forward cache. Any first page marks the session, so a reload, a return to home and arriving through a view transition all stay still.

It needs one flag in `sessionStorage`, `arrived`. No ADR rules storage out: ADR 0026 and 0027 keep the reader's choices in `localStorage`, and the "no local storage" of ADR 0019 is about Cloudflare's beacon. The flag is not a cookie, is never sent, holds no identifier and ends with the tab, and the colophon says so. The way without storage, `document.referrer` plus the navigation type, would replay it on every return from outside the site, which the entrance must not do.

**Contrast.** On the ground, muted text is 6.6:1 by day and 7.5:1 at night, the lamp 6.5:1 and 10.6:1, rose 6.6:1 and 8.3:1. `--line`, the edge of inputs, buttons and the dialogs, is at least 3.3:1 against the ground and the dialog surface (`e2e/contrast.spec.ts`).

## Consequences

- Fonts are 113 KB for the build (ADR 0017), down from 127 KB; home loads 72 KB of them.
- A new page is a `.column` unless it is a dashboard; a new list is rows, not cards.
- A new log puts its `time` first and the rest in one element, so the row's two columns hold.
- Mono in a new place needs to be data.
