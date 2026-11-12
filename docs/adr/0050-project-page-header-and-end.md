# 0050. How to get a project, and how its page ends

Status: accepted, 2026-11-12. Amends ADR 0027 (project pages get their own link-preview image, and `just fonts` writes a TrueType copy of the mono), ADR 0037 (the project header holds the install command and links), ADR 0038 (a project's receipt) and ADR 0049 (the line it left for a later change: each project page's own preview).

## Context

A UX audit of the live site (12 Nov 2026) found four problems on `/projects/<slug>`. The source link sat in a "Links" section at the end, two to three phone screens down, and llm-usage-metrics never gave its install command. Every page ended on "Writing about <project>", an empty list and two empty feeds. The receipt read "101 merges · 0 commits · 9 releases since 3 Oct 2026": the zero sounded like a dead project and the date like the project's age. The page had two "Updated" lines with different ages. A shared project link showed the generic site card.

## Decision

**Under the title.** Directly under the status line and above the screenshot:

- The install command, from a new optional flat frontmatter key, `install`, in the code face on the dark screen as on /skills. It wraps instead of scrolling, so all of it shows on a phone, and carries the copy button of a post's code block (`src/lib/markdown/code-copy.ts`, the same script). Without JavaScript or the Clipboard API there is no button and the command stays selectable. Each command is copied verbatim from the project's README on GitHub. A README that gives no single command gets no block: pi-mobile (a bridge and an app to set up), repo-pulse (a deploy button and secrets), agents-skills (one command per skill, and /skills shows the pattern), kipple and dotfiles.
- One line of links: "Source on GitHub", then "npm package" and the project's own site where they exist. The repository and npm links come from `packages/contracts/src/projects.ts` and the project file's `subdomain`, as before (`projectLinks` in `src/lib/projects.ts`). A project with no release says "No release yet: build from source", linked to the repository.

"No release" is known from the stored data, not a frontmatter key (`hasReleased`): yes when the projects snapshot has a latest release or the log has a release (the log keeps the newest ten releases however old, ADR 0046), no when the log has the project and none of its events is a release, and unknown when neither source has the project, so a failed pull never makes a project look unreleased. On the fixtures and on GitHub today, pi-mobile, kipple and dotfiles have none.

The "Links" section at the end repeated this line exactly, so it is gone. The card under a post keeps its links, with the same labels.

**The end of the page.** "Writing about <project>", its list and the line with its feeds show only once a published post is about the project; the page's `<link rel="alternate">` to the project's feeds follows the same rule. The feeds themselves still exist. In their place:

- "Follow releases", linking `<repository>/releases.atom`, for a project `hasReleased` says yes to.
- "Next: <project> →", the next project in /projects order (`projectsByGroup`), from the last back to the first.

**The receipt.** `projectReceipt` in `src/lib/days.ts` leaves out zero counts and says what the date is: "101 merges and 9 releases since 3 Oct 2026, when this site started counting". With every count at zero there is no line, since the log beside it can list merges the shipping history does not name (kipple's, in the fixtures). The text copy gives the same line under its numbers. /stats does not use it.

**One Updated line.** The numbers and the log each had their own freshness line. Now one line, `#project-updated`, follows the log and dates both: the older of the two times, and "May be out of date" if either is. Each live panel names it in `data-freshness`, and `src/lib/live-page.ts` keeps what each panel last showed and redraws the line from all of them, so it never claims fresher data than the page has. The build draws the same rule (`Freshness.astro` with several envelopes). In fixtures mode the line is the sample tape, as before. A project with `pull: false` has no live numbers, so the line dates the log alone.

**Link previews.** Each project page names `/og/projects/<slug>.png`, drawn by `renderOgCard` like the writing, TIL and year cards: the night room, the project's name in the mono (as its `h1`) and its tagline under it in the serif. sharp's Pango draws with fonts added through `fontfile`, and finds a family by name, so the TrueType copy of the mono is renamed "min7 Mono": as "JetBrains Mono" it matched the system copy installed on the owner's machine and passed locally while CI, without one, would have drawn another face. Pango also remembers a family it once failed to find, so `og-card.ts` adds both files before it draws any text. `just fonts` writes the mono copy; the committed WOFF2 files are unchanged.

**Text copy.** `/projects/<slug>.txt` follows the page's order from the same functions: the command and links under the status, the receipt under the numbers, the posts only when there are some, then the releases feed and the next project.

## Consequences

- Above the fold on a 390x844 phone (fixtures build): the name, the tagline, the status, the command and the links. On llm-usage-metrics the command wraps to two lines and the links end at y≈393; pi-extmgr's ends at y≈371; the screenshot starts under them. Before, the source link was at y≈2300.
- Pages with a command load the copy script, 0.3 KB gzip, counted in their 20 KB of JavaScript: llm-usage-metrics is at 19.1 KB.
- 13 more PNGs, 22 to 27 KB each, 323 KB in all, which no page budget counts. They add about 1.2 s to a 5.2 s local site build (85 to 103 ms each).
- `mono.ttf` (73 KB) is committed for the build and never reaches a page.
- A README that changes its install command needs the frontmatter updated by hand.
