# 0048. Images for content entries: certification badges

Status: accepted, 2026-11-12. Amends ADR 0037 (the room and a post's dots are no longer the only pictures) and ADR 0022 (the badges are not under the repository's licences).

## Context

Each certification on /about showed the issuer's initial in a hairline circle, drawn in the site's type in place of the issuer's logo, which belongs to the issuer and lived on another origin (commit 4b930dc, PR #195). The owner asked for the real badges.

## Decision

**One copy, committed.** Every image is downloaded once from its official source and committed under `apps/site/src/assets/badges/`. No page loads an image from another origin and no build fetches one, so the CSP, the budgets' "no other origin" rule and offline builds stay as they were.

| Image                                           | Source                                                                                                        | Licence                                                               |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Oracle Java SE 25, Java EE 7, Java SE 17        | the badge image on each Oracle certview share page, `brm-workforce.oracle.com/pdf/certview/images/<code>.png` | Oracle's trademark, shown to identify a certification the owner holds |
| Claude Certified Developer - Foundations, PSD I | the badge image on each Credly page, `images.credly.com/images/<id>/…`                                        | Anthropic's and Scrum.org's, the same way                             |

The Oracle images are 2:1 with the round badge in the middle; their transparent margins are trimmed, nothing else is changed. The others are as downloaded.

**Data in one place.** A certification in `content/about.json` takes an optional `badge`, `{ file, source, fetched }`: the file under `badges/`, the URL it came from and the day it was fetched. `contentImage` in `src/lib/content-images.ts` is its schema, and it fails the build when the file is not in the folder. The content cache keeps an entry whose JSON has not changed, so `imageFor` also throws when it is asked for a file that is gone. A certification without a badge gets its initial, as before.

**Served by the build.** Astro's `<Image>` (its sharp service; sharp was already a dependency) writes each as WebP at the size the page draws and twice that, with `width` and `height`, `loading="lazy"` and `decoding="async"`. The certifications are below the fold. No `layout` option, since Astro's responsive layouts write inline styles the CSP forbids.

**How they look.** A badge sits where the initial was, fitted to 3.5rem square so the names line up whatever its shape. Badges are drawn for white pages; on Night all five keep their shape against the ground (the darkest, Scrum.org's navy ring, stays distinct), so they have no plate or filter.

**Alt text.** A badge is decorative: the certification's name is the card's heading. So `alt=""`, and search, the text copy, feeds and structured data are unchanged.

## Consequences

The badges add 31,972 B to /about's counted weight (`just budgets` counts both sizes of each image; a browser fetches one). The page weighs 64.4 KB of its 150 KB budget, and Lighthouse still scores it 100 with CLS 0 on mobile and desktop (2026-11-12).

A badge that changes, a renewed certification for example, is fetched again by hand from the `source` beside it. Adding a certification with a badge is in CONTRIBUTING.
