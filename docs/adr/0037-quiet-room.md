# 0037. The quiet room

Status: accepted, 2026-11-01. Supersedes ADR 0034's windows, type and palette. Amends ADR 0026 (visual system) and ADR 0017 (font budget).

## Context

After the quiet windows (ADR 0034) the owner still found the site cartoony and generic. A critique of every page named the window chrome on every block, Fraunces' soft heavy cut, mono used for labels and buttons, seven hues with no meaning, murky gradients, dense underlines and a boxed header. Two options were built on real pages: A, "quiet room", where the room is the only picture and the rest is editorial; and B, "instrument panel", flat panels in a mono interface under the room. The owner chose A. One idea came over from B, the aligned time column in logs. The details pass follows Jakub Krehel's "Details that make interfaces feel better" (jakub.kr/writing).

## Decision

**The room is the only picture.** Everything under it is type, hairlines and space. `.panel` and `.paper` are sections, not boxes: a 1 px `--rule` above, the heading, and room around it. No title bars, file names, coloured squares, fills or gradients. The section that holds a page's title has no rule. The material classes (`m-screen` and the rest) only name the room's object a section belongs to.

**One reading column.** Every page but home and /stats reads in one centred column, `--column` (42 rem, about 70 characters of the 17 px serif), the same axis as a post: /writing, /til, a post, /projects, a project, /skills, /uses, /now, /about, /colophon and the 404. Lists in it are quiet rows on hairlines with a muted label on the right: a post's date, a project's post count and status, a skill's version, what a tool on /uses is. A short page keeps its footer at the bottom of the window (the body is a flex column).

**Logs have a time column.** Shipping events and recent tracks are one `.log`: the time in a fixed 7.5 rem column of muted mono on the left, the event or track beside it; under 30 rem the time sits over its row. The time comes first in the markup (`src/lib/stats-panels.ts`, `src/lib/listening-panel.ts`), so the build and a live answer draw the same row.

**Type.** Source Serif at 600 for headings, at four sizes for the whole site: the page title (2 to 2.75 rem, the same for a post), a section heading (1.375 rem), the text, and small print. JetBrains Mono only for data: dates, times, counts, versions, repository names and code. Labels, buttons, captions, tags, the table of contents and the footer are the serif. Fraunces is gone, and its file and `just fonts` entry with it; home loads two fonts, the serif roman and the mono, both preloaded (`e2e/room.spec.ts`). A post's file bar (`~/writing/<slug>.md`) is gone; its reading time is in the post's meta line.

**One accent.** Links, the current page and the heat strip are the lamp. Rose marks sample data, as a dot and a line. The ground is flat: paper white `#f6f2ea` by day, ink `#0e0c13` at night; only a post keeps the lamp's pool behind its title.

**Header and footer as words.** Search, Menu and the theme switch have no borders; the current page and the chosen theme are text over a 1 px lamp underline. The footer is one muted serif line.

**Details.**
- `-webkit-font-smoothing: antialiased` on the whole page.
- `text-wrap: balance` on headings, `text-wrap: pretty` on paragraphs, list items and definitions.
- `tabular-nums` on every time, number and data cell, so a ticking "3 minutes ago" or a column of counts does not shift.
- Concentric corners: controls (inputs, buttons, `kbd`, inline code) take `--radius` (4 px); the dialogs and the Menu popover, with 1 rem of padding, take `--radius` plus 1 rem, so a Close button or the search field in a corner sits concentric with it. Code blocks and post art take twice `--radius`, and square corners where they run to a phone's edge.
- Post art and images in posts have a 1 px outline in the text colour at 10%, so they hold their edge on either ground.
- Hover changes colour with a 120 ms transition, never a keyframe animation, so it stays interruptible. The transition applies only while hovered, so a change of theme recolours the page in one frame. The dialogs and the Menu open without animation. The reduced-motion rule takes every transition and animation to nothing.

**Contrast.** On the ground, muted text is 6.6:1 by day and 7.5:1 at night, the lamp 6.5:1 and 10.6:1, rose 6.6:1 and 8.3:1. `--line`, the edge of inputs, buttons and the dialogs, is at least 3.3:1 against the ground and the dialog surface (`e2e/contrast.spec.ts`).

## Consequences

- Fonts are 113 KB for the build (ADR 0017), down from 127 KB; home loads 72 KB of them.
- A new page is a `.column` unless it is a dashboard; a new list is rows, not cards.
- A new log puts its `time` first and the rest in one element, so the row's two columns hold.
- Mono in a new place needs to be data.
