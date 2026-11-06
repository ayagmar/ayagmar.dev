# 0042. Page changes that keep the header still

Status: accepted, 2026-11-06

## Context

Every page is its own document (ADR 0026, ADR 0017), so each click repainted the header and swapped the column at once. Cross-document view transitions keep that model: two CSS rules, no router and no script. `@view-transition` is in Chrome and Edge 126 and Safari 18.2; Firefox has it behind a preview only (MDN browser-compat-data, 2026-11-06). The rule must be in both documents. Reloads, cross-origin navigations and browser UI navigations do not transition (CSS View Transitions Level 2, §2.3 and §9).

## Decision

**A short fade, in CSS only.** `@view-transition { navigation: auto; }` in `base.css`, so every page that uses `Base.astro` has it, the 404 included. There is no Astro `ClientRouter`, as it would bring a client runtime the budgets forbid (ADR 0017).

**Tokens.** `--page-change` is 160 ms and `--page-change-ease` is `ease-out`, next to the layout tokens; the site had no motion tokens. It is a little longer than a hover's 120 ms because the whole column moves, and a crossfade has no overshoot to be bouncy with. They apply to the root group, and its old and new images inherit them, so the two opacities still add up to one.

**One name: `site-header`.** The wordmark, search, nav and theme switch are part of it and have no names of their own.

- Its group, old image and new image do not animate. With the default morph, a page left scrolled down would slide the header in from above the window. It changes in one frame, so only the current-page underline differs.
- The header is the only named element that exists on every page. Its new image is live, so search hydrating looks as it does on a full load.

**No other names.**

- Post title, list to post: a per-item name needs an inline style, which the CSP forbids (ADR 0019), a script, or typed `attr()`, which Safari has only in preview (MDN browser-compat-data). A row's title growing into a 2.75 rem heading is also not quiet.
- The room: it exists only on home, so there is nothing for it to match. It fades with the column.
- The footer: its position differs per page, so a name would make it travel.

**Live pieces are not named, and nothing is cached.** The old side of a transition is a snapshot, but the new side is the live page, so a script's update shows through as it does on a plain load. Old live state can only morph into stale build state if the same piece is named on both pages, and none is.

| Piece                  | Decision                                                                                        |
| ---------------------- | ----------------------------------------------------------------------------------------------- |
| Room clock, sky, cat   | Fade with the column. `room.ts` filled them 47 to 61 ms after `pagereveal` at 4x CPU throttling |
| Weather                | Fades with the column; arrives as it does on a load                                             |
| Now playing            | Fades with the column; arrives as it does on a load                                             |
| Lamp coming on, record | Run behind the fade, from the new document                                                      |

The one place old live state meets build state is a link from a page to itself, such as the wordmark on home: the fade ends on the build's line until the script answers, as a reload does. That does not justify a storage cache of API answers.

**Reduced motion.** Everything sits under `@media (prefers-reduced-motion: no-preference)`, because the global reduced-motion rule does not reach the transition's pseudo-elements. With `reduce` the document does not opt in, so there is no transition.

**Scrollbars.** From 52 rem, the same rule block sets `scrollbar-gutter: stable`. A page too short to scroll otherwise centres the header 7.5 px to the right of one that scrolls, with a classic 15 px scrollbar. Narrower than that it stays off: phones overlay their scrollbars and the gutter would only take width from the room's hotspots, which WCAG 2.2 needs at 24 px. This is the one rule a browser without cross-document transitions also gets, as CSS has no widely supported test for an at-rule: on classic scrollbars, a short page in Firefox keeps an empty gutter and its header holds still there too.

**Theme.** The blocking script runs before the new document's first frame, so a choice made just before a click holds on every frame. A page restored from the back/forward cache is the exception: it keeps the DOM it was left with, so a choice made on the next page was lost, and the transition faded into the old theme. `theme.js` now reads storage again on a persisted `pageshow`, which comes before the transition's first frame. This is the only script change, under 30 bytes gzipped, inside the theme switch's allowance.

## Consequences

- A click during the fade lands on `<html>` and is lost: the spec has captured elements skip hit testing, and `::view-transition { pointer-events: none }` does not change that, measured in Chromium with a slowed fade. The window is 160 ms, and the time a page takes to load is unaffected, as the old page stays live until the new one is ready.
- Scroll position, focus, the skip link and in-page anchors are the browser's as before; a `#heading` link is a same-document navigation and never transitions.
- Feeds, `.txt` and images do not opt in, so going to one is a plain navigation. So is an external link.
- CSP unchanged: everything is in the stylesheet, and `postbuild.ts` needed no change.
- A new element that should hold still between pages needs its own name, unique per page, or the transition is skipped.
- `e2e/transitions.spec.ts` runs with classic scrollbars, which Playwright hides by default. It uses a synthetic persisted `pageshow`, like the other specs, as Playwright's browser has the back/forward cache off.
