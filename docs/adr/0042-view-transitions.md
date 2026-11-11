# 0042. Page changes that keep the header still

Status: accepted, 2026-11-06. Amended 2026-11-11: while no post is published /writing is empty, so the no-script link reads "Browse projects" and goes to /projects; with the first post it is "Browse writing" again (`browseLink` in `src/lib/writing.ts`). The 404 uses the same two classes, so it mentions Search only when the page has one.

## Context

Every page is its own document (ADR 0026, ADR 0017), so each click repainted the header and swapped the column at once. Cross-document view transitions keep that model: two CSS rules, no router and no script. `@view-transition` is in Chrome and Edge 126 and Safari 18.2; Firefox has it behind a preview only (MDN browser-compat-data, 2026-11-06). The rule must be in both documents. Reloads and cross-origin navigations do not transition, nor do pushes and replaces the browser's own UI starts, such as the address bar. Back and forward do, browser buttons included, unless the browser plays its own gesture animation instead (CSS View Transitions Level 2, §2.3 and §9).

## Decision

**A short fade, in CSS only.** `@view-transition { navigation: auto; }` in `base.css`, so every page that uses `Base.astro` has it, the 404 included. There is no Astro `ClientRouter`, as it would bring a client runtime the budgets forbid (ADR 0017).

**Tokens.** `--page-change` is 160 ms and `--page-change-ease` is `ease-out`, next to the layout tokens; the site had no motion tokens. It is a little longer than a hover's 120 ms because the whole column moves, and a crossfade has no overshoot to be bouncy with. They apply to the root group, and its old and new images inherit them, so the two opacities still add up to one.

**One name: `site-header`.** The wordmark, search, nav and theme switch are part of it and have no names of their own.

- Its group, old image and new image do not animate. With the default morph, a page left scrolled down would slide the header in from above the window. It changes in one frame, so only the current-page underline differs.
- The header is the only named element that exists on every page. Its new image is live, so anything that changes after the first frame shows at once. Search did: the island hydrates up to 2 s after the page, and its server-rendered link read "Browse writing". With scripts on, that link now has the button's label, hint and box, and it still goes to /writing. It tells scripts are on from `data-theme-switch`, set before the first paint; without scripts it stays "Browse writing", so that reader is not offered a search that needs them.

**No other names.**

- Post title, list to post: a per-item name needs an inline style, which the CSP forbids (ADR 0019), a script, or typed `attr()`, which Safari has only in preview (MDN browser-compat-data). A row's title growing into a 2.75 rem heading is also not quiet.
- The room: it exists only on home, so there is nothing for it to match. It fades with the column.
- The footer: its position differs per page, so a name would make it travel.

**Live pieces stay in the root capture, and nothing is cached.** Leaving a piece unnamed does not exclude it: it is part of the implicit `root` capture, so the old page's live values are in the old image. The new image is the live new page. So what a reader sees depends on whether the old and new page are the same page.

- **A link to the open page** (the wordmark on home, Stats on /stats): the old image holds live values and the new document starts from the build's, so a fade would dissolve the current answer into an older one and jump back when the request returns. `theme.js` skips the transition in `pageswap` when the destination is the document's own URL, ignoring the fragment. This is the plain load the site had before, with the stale frame a reload has and no blend. This is the only such case: a self-link is the only way the same live piece is on both sides.
- **A link to another page**: nothing live is on both sides. The old page fades out with its values, and the new page's scripts draw over the live new image, as on a load.

| Piece                  | Arriving from another page                                                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Room clock, sky, cat   | Fade in with the page, which may start without them. `room.ts` filled them 47 to 61 ms after `pagereveal` at 4x CPU throttling, warm cache. A cold load is not bounded by that |
| Weather, now playing   | The build's state, then the answer when it comes, unbounded, as on a load                                                                                                      |
| Lamp coming on, record | Run behind the fade, from the new document                                                                                                                                     |
| /stats panels          | Build values, replaced when the answers come, as on a load                                                                                                                     |
| /uses live panel       | Hidden until its requests return, so it appears after the fade, as on a load                                                                                                   |

A first paint with live values would need a storage cache of API answers. Nothing here shows a need for one: no live value blends into a stale one, and every arrival is what a load already was.

**Reduced motion.** Everything sits under `@media (prefers-reduced-motion: no-preference)`, because the global reduced-motion rule does not reach the transition's pseudo-elements. With `reduce` the document does not opt in, so there is no transition.

**Scrollbars.** The same block sets `scrollbar-gutter: stable`, at every width, as classic scrollbars do not depend on the window's width. A page too short to scroll otherwise centres the header 7.5 px to the right of one that scrolls, with a 15 px scrollbar. Overlay scrollbars get no gutter, so phones keep their full width. This is the one rule a browser without cross-document transitions also gets, as CSS has no widely supported test for an at-rule: with classic scrollbars, a short page in Firefox keeps an empty gutter and its header holds still there too. Playwright's hidden scrollbars do keep a gutter, which takes 15 px from the room at 360 px, so `.hotspot` has a 24 px minimum; a real narrow window with a classic scrollbar needed that already. Tests about a phone's width use `isMobile`, which gives the overlay scrollbars a phone has.

**Theme.** The blocking script runs before the new document's first frame, so a choice made just before a click holds on every frame. A page restored from the back/forward cache is the exception: it keeps the DOM it was left with, so a choice made on the next page was lost, and the transition faded into the old theme. `theme.js` now reads storage again on a persisted `pageshow`, which comes before the transition's first frame. With the `pageswap` skip, these are the only script changes, and they fit the theme switch's allowance.

## Consequences

- The fade is not interruptible, which falls short of what ADR 0037 asks of motion. For its 160 ms a pointer click lands on `<html>` and is lost: captured elements skip hit testing, and `::view-transition { pointer-events: none }` does not change that (spec §4.2 and §7.1.1; measured in Chromium with a slowed fade). While the next page loads the old page stays live, so only the fade itself is affected. The only way to remove the window is to remove the transition, so this is a trade the owner accepts or rejects.
- Scroll position, focus, the skip link and in-page anchors are the browser's as before; a `#heading` link is a same-document navigation and never transitions.
- Feeds, `.txt` and images do not opt in, so going to one is a plain navigation. So is an external link.
- CSP unchanged: everything is in the stylesheet, and `postbuild.ts` needed no change.
- A new element that should hold still between pages needs its own name, unique per page, or the transition is skipped.
- `e2e/transitions.spec.ts` runs with classic scrollbars, which Playwright hides by default. It uses a synthetic persisted `pageshow`, like the other specs, as Playwright's browser has the back/forward cache off, so a real restore was checked by hand in full Chromium.
