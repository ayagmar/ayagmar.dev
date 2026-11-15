# 0021. RSS and Atom written by hand from one model

Status: accepted, 2026-10-26. Amended 2026-11-15: the tag page moved to `/tags/<tag>` and lists notes too (ADR 0028). The tag feeds stay at `/writing/tags/<tag>/feed.xml` and `atom.xml`, posts only, and keep `/writing/tags/<tag>` as their id and page link so they do not change by a byte; `public/_redirects` sends that address to `/tags/<tag>` with a 301. `tagFeedPath` in `writing.ts` builds the old address, `tagPath` the page's. A tag page with posts links its tag's feeds; one with notes only links the TIL feeds.

## Context

Readers come back through feeds. `@astrojs/rss` writes RSS only; Atom would need a second library.

## Decision

`apps/site/src/lib/feed.ts` builds one feed model from the published posts and renders it twice: RSS 2.0 (`/feed.xml`) and Atom 1.0 (`/atom.xml`), plus the same pair per tag (`/writing/tags/<tag>/feed.xml` and `atom.xml`).

- Text is XML-escaped (`& < > " '`) and characters XML 1.0 forbids are dropped. Summaries are plain text (`type="text"` in Atom).
- Every URL is absolute (`https://ayagmar.dev/...`). Each feed links to itself (`rel="self"`, and `atom:link` in RSS).
- RSS dates are RFC 822 (`toUTCString`), Atom dates RFC 3339.
- Atom entry ids are tag URIs, `tag:ayagmar.dev,<publish date>:/writing/<slug>`, so editing a post or adding others never changes an id. Feed ids are `tag:ayagmar.dev,2026:/writing` and `...:/writing/tags/<tag>`.
- A feed's `updated` is the newest entry's `updated` (or `date`); an empty feed uses a fixed date so its bytes do not change between builds.
- Drafts never reach a feed in a production build.
- Every page links the site-wide feeds with `<link rel="alternate">`; tag pages also link their tag's feeds.

Unit tests cover escaping, absolute URLs, dates, id stability, tag feeds and drafts. Playwright parses every built feed with the browser's XML parser.

## Consequences

No feed dependency. Renaming a post's file changes its URL and its Atom id.
