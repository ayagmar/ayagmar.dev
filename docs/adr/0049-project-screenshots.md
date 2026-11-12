# 0049. A screenshot on each project page, and an image viewer

Status: accepted, 2026-11-12. Amended 2026-11-12: each project page now has its own link preview (ADR 0050). Extends ADR 0048 (a third image folder, with the same schema and committed copies; the plugins' thumbnails open their screenshots), amends ADR 0037 (project pages now have a picture) and ADR 0017 (the viewer's script has an allowance).

## Context

The project pages were text and live numbers. Most projects already publish screenshots in their own repositories, for their READMEs and sites. The owner asked for one on each page, using the image pattern of ADR 0048 rather than a second one, and for no capture from this machine, since one can show private data.

## Decision

**What is shown.** One picture per project, of the view that shows what it does, taken from what the project's repository published on its default branch:

| Project             | Image                                                                | Commit    |
| ------------------- | -------------------------------------------------------------------- | --------- |
| llm-usage-metrics   | `site/src/assets/screenshots/share-daily-{light,dark}.webp`, cropped | `76e8c6c` |
| runnerd             | `site/src/assets/dashboard/history-{light,dark}.webp`                | `2123660` |
| ccdesk              | `site/src/assets/screenshots/context-{light,dark}.webp`              | `2b33b70` |
| pi-extmgr           | `docs/assets/installed-workspace.png`                                | `899dfbd` |
| pi-codex-web-search | `docs/images/web-search-demo.png`                                    | `d35aae6` |
| pi-promptsmith      | one frame of `promptsmith.gif`, cropped                              | `082878a` |
| claude-modmgr       | `docs/images/discover.png`                                           | `0147012` |
| niri-computer-use   | `site/public/demo/errand.png`                                        | `c224322` |

The full raw URL at the commit is the `source` beside each file. Two are changed. llm-usage-metrics keeps the totals and the cost chart (rows 415 to 975 of 1000), without the title and filters above them, so the day and night pair fits the page budget. pi-promptsmith is frame 181 of 301, rows 714 to 1270: the rewritten prompt and the `/promptsmith` commands, without the list of loaded files above them; the GIF is 1.7 MB and the page shows a still.

pi-mobile, agents-skills, dotfiles and kipple have no screenshot in their repositories (kipple has brand art only), and repo-pulse has none that fits: `docs/images/repo-pulse.png` is a banner, and `docs/images/stars.png` shows another person's GitHub name and avatar starring and un-starring a repository, which does not belong on this site. Those five pages are as before until their repositories publish one. A logo or banner does not stand in.

**Data.** `content/project-screenshots.json` lists one entry per project that has a screenshot: its `slug`, `alt` and either `image`, or `day` and `night`, each `{ file, source, fetched }` as in ADR 0048, checked by its `contentImage` schema with a third folder, `apps/site/src/assets/projects/`. A slug that is not a featured project, a project listed twice, half a pair and a file that is not in the folder each fail the build. A project not in the list renders as before. The entries are not in each project's frontmatter because Biome formats `content/projects/*.md` as Markdown, frontmatter included, and flattens nested YAML, which is why those files hold only flat keys. The schema is in `src/lib/project-screenshot.ts`, apart from `projectSchema`, because the image folders are a Vite glob and `scripts/` type-check `project-schema.ts` without Vite's types.

**Theme.** Where a project publishes a light and a dark version of the same view, the page has both and CSS shows the one for the theme, as the room does: `prefers-color-scheme` without a stored choice, `data-theme` with one. Without scripts the system theme decides, so exactly one shows. Both are `loading="lazy"`, which keeps the hidden one from being fetched at all; the e2e tests check that only the shown file is requested. Browsers load lazy images at once when scripts are off, so a visitor without them downloads both and sees one. A single image is drawn as it is in both themes, with the faint text-colour edge and small radius of a plugin thumbnail.

**Size.** It sits under the header, as wide as the reading column (672 px) and at most 560 px tall, so claude-modmgr's tall dialog is drawn 389 px wide rather than 967 px tall. The build writes WebP at that width and twice it (never wider than the source), at quality 60, with `width`, `height` and `sizes="min(<width>px, 100vw - 2rem)"`. A single image is the page's largest paint, so it loads eagerly with `fetchpriority="high"`; a pair keeps `fetchpriority="high"` with its lazy loading. The image links to the committed file at full size, which the viewer below opens on the page.

**The viewer.** The owner asked that a screenshot open on the page, not navigate to the file. One viewer serves every image that opens large: the project screenshots and the Noctalia plugins on /projects. Each is a link to its full-size file, marked `data-view` by `src/components/Viewable.astro`; without JavaScript it stays that link. `src/components/ImageViewer.astro` holds a native `<dialog>` and its script, `src/scripts/image-viewer.ts`, and a page includes it only when it has such a link, so other pages load neither.

- A click (without a modifier, which keeps its meaning of a new tab) opens the dialog with `showModal`. It covers the window on the page's ground, with a Close button, the alt text as its caption and name, and an "Open original" link to the file. Focus moves to Close and returns to the link on close; the page behind does not scroll while it is open; it fades in only without `prefers-reduced-motion`.
- The image is drawn as large as the window allows and never past the file's own pixels. The build writes WebP at 1,344 and 2,048 px and the source's own width (no wider than the source, quality 80), listed only in data attributes, so nothing is fetched and the budgets count nothing until it opens; the script sets `sizes` to the width it draws and the browser picks the file.
- It closes with the button, Escape, a click or tap on the empty space around the image, and Back. Opening pushes a history entry so Back, or the back gesture on a phone, closes it; closing any other way calls `history.back()` to take the entry off, so the next Back leaves the page as before.
- Of a day and night pair only the link on screen counts, so the viewer opens the version for the current theme. Where a page has several images (the three plugins on /projects), it shows "2 of 3" with Previous and Next, and the arrow keys step through; it wraps from the last to the first. With one image it shows no navigation.

The plugins' thumbnails are 160 px and too small to enlarge, so each opens the plugin's `screenshot.png` from its directory in noctalia-dev/community-plugins, at the same commit as the thumbnail (`2f15521`) and under the same MIT licence. It is `screenshot` with `alt` and `image` in `content/noctalia-plugins.json` and lives in `apps/site/src/assets/plugins/`. The thumbnail link is named "A screenshot of <plugin>", since the thumbnail itself has no alt. Certification badges link to their verify pages, as before, and are not in the viewer.

**Alt text.** One sentence on what is on screen. Unlike ADR 0048's images it carries information the page's text does not, so it is not decorative. Search, the text copies, feeds, `llms.txt` and structured data list no images today and stay unchanged.

**Not done.** /projects keeps its rows without thumbnails. The weight would fit: thumbnails at 160 and 320 px for the eight projects with screenshots are about 61 KB, taking /projects from 51 KB to about 112 KB of 150 KB. But at 160 px a dashboard or a terminal is unreadable, the shapes run from 4:1 (pi-promptsmith) to 2:3 (claude-modmgr), and five of thirteen rows would have none, so on a phone the list would turn into a column of small grey blocks. The link preview of a project page stays the generated default; giving each page its own preview from its screenshot is a separate change to `src/lib/og.ts`.

## Consequences

`just budgets` counts every size of both versions, though a browser fetches one file. Added to each page's counted weight: runnerd 80,784 B, ccdesk 82,750 B, claude-modmgr 92,260 B, llm-usage-metrics 66,398 B, niri-computer-use 47,640 B, pi-codex-web-search 36,180 B, pi-extmgr 35,344 B and pi-promptsmith 15,206 B. The viewer adds its script (845 B gzip, an allowance of 0.93 KB in ADR 0017) and its dialog to each page that has it, about 1.3 KB; its large files are counted nowhere since no page refers to them before it opens. The heaviest page, claude-modmgr, weighs 129.8 KB of its 150 KB, and /projects 52.8 KB, up from 51.2 KB.

A local Lighthouse run (2026-11-12, Lighthouse 13.6, the Wrangler server, one run each) scores runnerd, claude-modmgr, llm-usage-metrics and /projects 100 on performance and accessibility (claude-modmgr 99 on mobile) with CLS 0. LCP is now the screenshot: on mobile 0.91 s for llm-usage-metrics, 1.66 s for runnerd and 1.96 s for claude-modmgr, whose 778 px image is 67 KB, against the 2.0 s budget; on desktop 0.42 to 0.45 s against 1.0 s, up from 0.26 s for a page without one. CI measures the largest project page, llm-usage-metrics, where desktop LCP moves from about 278 ms to about 453 ms because the largest paint is now the screenshot instead of text. The absolute 1.0 s budget holds; the regression rule of ADR 0017 (10 % and 100 ms over the base) fails on it by design, once, on the pull request that adds the screenshots. The rule stays as it is.

A screenshot that goes out of date is replaced the same way it was added, from the project's repository at a newer commit. Adding one is in CONTRIBUTING.
