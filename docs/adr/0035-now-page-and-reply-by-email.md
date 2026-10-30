# 0035. A /now page and reply by email

Status: accepted, 2026-10-30

## Context

The owner wants a page in the nownownow.com sense, what they are working on this month, and a way for a reader to answer a post without an account anywhere. The site has no comments or forms, so the answer is an email.

## Decision

### /now

- `content/now.md` is a one-entry Astro collection (`now`, glob on that file). Frontmatter: `updated`, a required day that may not be after the day of the build, and `brewing`, a list of `{ name, note, url? }`. `name` is 1 to 60 characters, `note` 1 to 240, `url` https only. Unknown fields fail the build like posts' do, and every failure names the field (`updated: must not be in the future`, `brewing.0.url: must be an https:// URL`). The schema is `nowSchema(built)` in `src/lib/now-schema.ts`; the collection passes the build's date, and tests pass a fixed one.
- The page is the "Currently brewing" window (`Brewing.astro`, ADR 0034 chrome, a name linked when it has a `url`) and the Markdown body in a `.paper` window. An empty or missing `brewing` draws no window. Nothing needs JavaScript to read.
- It shows "Updated <day>" as an absolute date in a `<time datetime>`. `time[data-ago]` was not reused: it rewrites an instant as "3 minutes ago" for live data (ADR 0015), and a hand-written page is dated by a day, which should stay a day.
- **Out of date.** When `updated` is more than 90 days before the reader's clock, a line says "This page may be out of date". It is decided in the browser (`src/scripts/now.ts`, `isStale` in `src/lib/now.ts`), not at build: the site is rebuilt on deploys, so a page built fresh can be served for months, and a build-time check would claim a freshness it no longer has. Without JavaScript the reader sees the absolute date and no warning, which is true if less helpful. The line is in the HTML, hidden, so a script that fails leaves nothing broken.
- Links: the footer and /about. Not the header, which stays one row at 320 px. `nowPage` in `site.ts` holds the path and label, which the footer, /about and `index.txt` read; the sitemap lists it like any page.
- The first content is a draft from the owner's public repositories' own descriptions, for the owner to edit.

### Reply by email

- The address is `site.email` in `site.ts` (`hello@ayagmar.dev`), plain `mailto:`, no obfuscation (the owner's choice). /about shows it. The colophon lists no contact, so it is unchanged.
- Every post and every TIL note page ends with "Reply by email", `mailto:<address>?subject=Re: <title>`. `replyHref(title)` in `site.ts` is the one place that builds it; the subject goes through `encodeURIComponent`, which writes spaces as `%20`, never `+`, and escapes `&`, `#`, `?`, `%` and non-ASCII (RFC 6068). The title is never cut, so a very long title makes a long link, which mail clients accept. `/til`, where notes are stacked, has no link; each note's own page does.
- **Feeds are unchanged.** The link is not added to RSS or Atom item content: changing every item would make readers show them all as updated. The built feeds were compared with a build of `main`, all 28, and are byte-identical.

## Consequences

- The out-of-date line costs a 141 B script on /now only.
