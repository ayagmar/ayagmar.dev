# 0048. Images for content entries: certification badges and plugin thumbnails

Status: accepted, 2026-11-12. Amends ADR 0037 (the room and a post's dots are no longer the only pictures), ADR 0047 (the plugins now have thumbnails) and ADR 0022 (the badges are not under the repository's licences).

## Context

Each certification on /about showed the issuer's initial in a hairline circle, drawn in the site's type in place of the issuer's logo, which belongs to the issuer and lived on another origin (commit 4b930dc, PR #195). The Noctalia plugins on /projects had no thumbnails, because their images live in noctalia-dev/community-plugins and the CSP allows images from the site alone (ADR 0047). The owner asked for the real badges and for the thumbnails.

## Decision

**One copy, committed.** Every image is downloaded once from its official source and committed under `apps/site/src/assets/`: the badges in `badges/`, the thumbnails in `plugins/`. No page loads an image from another origin and no build fetches one, so the CSP, the budgets' "no other origin" rule and offline builds stay as they were.

| Image                                           | Source                                                                                                        | Licence                                                               |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Oracle Java SE 25, Java EE 7, Java SE 17        | the badge image on each Oracle certview share page, `brm-workforce.oracle.com/pdf/certview/images/<code>.png` | Oracle's trademark, shown to identify a certification the owner holds |
| Claude Certified Developer - Foundations, PSD I | the badge image on each Credly page, `images.credly.com/images/<id>/…`                                        | Anthropic's and Scrum.org's, the same way                             |
| headroom, binance, obs-control                  | `thumbnail.webp` in each plugin's directory, at commit `2f15521`                                              | MIT, copyright the owner (each directory's `LICENSE`)                 |

The Oracle images are 2:1 with the round badge in the middle; their transparent margins are trimmed, nothing else is changed. The others are as downloaded.

**Data in one place.** A certification in `content/about.json` takes an optional `badge` and a plugin in `content/noctalia-plugins.json` an optional `thumbnail`, both `{ file, source, fetched }`: the file under its folder, the URL it came from and the day it was fetched. `contentImage` in `src/lib/content-images.ts` is the one schema for both, and it fails the build when the file is not in the folder. The content cache keeps an entry whose JSON has not changed, so `imageFor` also throws when it is asked for a file that is gone. An entry without the field renders as before: a certification gets its initial, a plugin a row without a picture.

**Served by the build.** Astro's `<Image>` (its sharp service; sharp was already a dependency) writes each as WebP at the size the page draws and twice that, with `width` and `height`, `loading="lazy"` and `decoding="async"`. Both sections are below the fold. No `layout` option, since Astro's responsive layouts write inline styles the CSP forbids.

**How they look.** A badge sits where the initial was, fitted to 3.5rem square so the names line up whatever its shape. Badges are drawn for white pages; on Night all five keep their shape against the ground (the darkest, Scrum.org's navy ring, stays distinct), so they have no plate or filter. A thumbnail gets the faint text-colour edge that images in posts have, so the dark tiles hold their shape by day, and the small radius. It is 10rem wide: above the name on a phone, so the summary keeps the column's measure, and left of the name and summary from 36rem.

**Alt text.** Both are decorative: the certification's name is its heading and the plugin's name and summary are the row's text, which the thumbnail repeats. So `alt=""`, and search, the text copies, feeds and structured data are unchanged.

## Consequences

The images add 31,972 B to /about's counted weight and 19,054 B to /projects' (`just budgets` counts both sizes of each image; a browser fetches one). The pages weigh 64.4 KB and 51.1 KB of their 150 KB budget, and Lighthouse still scores both 100 with CLS 0 on mobile and desktop (2026-11-12).

A badge that changes, a renewed certification for example, is fetched again by hand from the `source` beside it. Adding a certification or plugin with an image is in CONTRIBUTING.
