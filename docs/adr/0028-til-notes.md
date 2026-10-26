# 0028. TIL notes

Status: accepted, 2026-10-26

## Context

The owner wants a stream of short "today I learned" notes next to the long posts: a few lines to a few paragraphs, shown together, with a feed of their own. Posts, tags, drafts, feeds, search and the plain-text index already exist (ADRs 0021, 0024, 0025, 0026). The notes should reuse them instead of growing a parallel path.

## Decision

### Content

- `content/til/<slug>.md`, a second Astro collection. Frontmatter: `title`, `date`, optional `tags` and `draft`. Unknown fields fail the build, so a post-only field such as `summary` is an error on a note. The schema is `apps/site/src/lib/til-schema.ts`; `date` and the tag rules are the exports `day` and `tagList` of `writing-schema.ts`, so posts and notes share one vocabulary.
- A note has no `summary`. Where one is needed (feeds, the page description) `noteSummary` in `til.ts` takes the first paragraph of the body as plain text: code blocks, headings, lists and quotes before it are skipped, links and emphasis lose their markup, and it is cut at a word after 200 characters. A note that starts with code and has no paragraph uses its title.
- Drafts use the posts' rule, now `publishedEntries` in `writing.ts` (it was `publishedPosts`, typed to posts): production builds drop them, `PUBLIC_SHOW_DRAFTS=1` keeps them, newest first. Two seed notes from the owner's public changelogs (niri-computer-use 0.1.4, llm-usage-metrics 0.13.0) are `draft: true`, so the owner decides what ships.

### Pages

- `/til` shows every published note in full, newest first, each as an `article` with its title (the permalink, a link to `/til/<slug>`), its date, its tags and its rendered body. With none, it says "Nothing published yet." and still links its feeds.
- `/til/<slug>` is one page per note, with the post header (`PostHeader.astro`, now taking anything with a title, date, tags and draft flag) and the reader layout of ADR 0026 (`article.reader`) and prose.
- Tags on a note are plain text. `/writing/tags/<tag>` exists only for tags some post uses, so a link could lead nowhere; a TIL tag page would be a new feature.
- Notes render during every build, like posts (`deferRender`), so the diagram renderer runs on each. `/diagrams.css` collects the styles of posts and notes. Because `/til` puts many notes on one page, every id a note's Markdown makes carries its file name (`first-note-diagram-1`, `first-note-example`, `first-note-user-content-fn-1`), and so do the `#fragment` links and ARIA references that point at them, so a section link or a footnote mark in one note never lands in another. `markdown/scope-ids.ts` holds the one rule (`idScope`, empty for a post) and the `scopeIds` pass, which runs before `diagrams`; the diagram pass takes its prefix from the same function. A post's ids are unchanged.
- No client JavaScript is added to any page. The CSP is unchanged.

### Feeds

- `feed.ts` keeps one model and two renderers. `buildFeed` (writing, a tag, a project) and the new `buildTilFeed` both produce entries and hand them to one `assemble`, so `renderRss` and `renderAtom` are the only writers. `feedScope` also describes the TIL feeds (`{ til: true }`), which is how `Base.astro` adds their `<link rel="alternate">` on TIL pages and nowhere else.
- `/til/feed.xml` and `/til/atom.xml`. Feed id `tag:ayagmar.dev,2026:/til`; entry ids `tag:ayagmar.dev,<date>:/til/<slug>` (ADR 0021), so editing a note never changes its id. A note has no `updated`; its `updated` is its date. An empty feed uses the fixed date of the other empty feeds. Notes are in no writing feed, and no post is in the TIL feeds.
- The writing feeds do not change by a byte. Golden files `test/golden/{feed,atom}-{site-wide,tag,project}.xml` were written by the code before this change and `feed.test.ts` compares today's output with them; the built `/feed.xml`, `/atom.xml` and every tag and project feed were also compared with a build of `main` before the change.
- The e2e check (`e2e/feed-rules.ts`) parses both TIL feeds with the browser's XML parser and enforces the rules of the W3C Feed Validation Service that need no network. RSS 2.0: version 2.0, one channel, channel `title`, `link` and `description`, a `lastBuildDate` in RFC 822 form that parses, an `atom:link rel="self"` equal to the feed's URL, and for each item a `title`, an absolute `link`, a `guid` equal to the link, a `description`, a `pubDate` in RFC 822 form, non-empty categories and no repeated item. Atom 1.0: the Atom namespace, `id` (a tag URI), `title`, `updated` and an author on the feed (entries carry none), `updated` and `published` in RFC 3339 form that parse, one `rel="self"` link equal to the feed's URL and one `rel="alternate"` link to `/til`, and for each entry a unique tag-URI `id`, `title`, `updated`, a `rel="alternate"` link, absolute URLs. What it does not check: the validator's own advice (it warns about long titles, say) and the content of a remote request.

### Search

A note page carries `data-pagefind-body` and a hidden element with `data-pagefind-meta="title"` that reads "TIL: <title>", so Pagefind's result title is "TIL: <title>" and a result says what it is without touching the search island. A label under the result, in the line style of the project label (ADR 0025), was tried first and cost 19 bytes more than the home page's island budget (20,480 B) allows, so it was dropped. The `/til` listing is not indexed (it has no `data-pagefind-body`), so each note is found once, at its own page.

### The text index and navigation

- `index.txt` gets a "TIL" section after Writing: the five newest notes, each with its date, title and URL, or "Nothing published yet."
- `TIL` is in `nav` (`site.ts`), so the header, the 404 page and the text index list it after Writing. The room gets an eighth object, the keyboard on the desk, leading to `/til`; its hotspot is a 17.5% by 20% box (at least 24 CSS px from a 360 px viewport up, like the others) with its rectangle in `room.css`. It sits between the monitor and the tea set in reading order, so the keys 1 to 3 are unchanged and 4 to 8 follow the list. ADR 0026 says seven objects; there are eight now. This is the minimum; the design pass can give notes a better object.

### Tests

- Unit: feed ids, drafts and empty feeds for notes; the golden files for the writing feeds; `noteSummary`; the frontmatter schema; diagram ids; ids, fragment links and aria references of two stacked notes through a real Astro build; Astro failing a build on a bad note.
- e2e on the production build (`e2e/til.spec.ts`): the empty state, the feeds against the validator rules, TIL feed links only on TIL pages, and that no draft note reaches `/til`, its permalink, either feed, the writing feeds, search, `index.txt` or the sitemap. The generic page tests (axe at 360 and 1280 px, 320 px overflow) run on `/til` as it is in the sitemap, and on every published note.
- e2e on a build that shows drafts (`e2e/til-preview.spec.ts`): while every note is a draft, the production build has no note page to test. `just site-build-preview` builds the site with `PUBLIC_SHOW_DRAFTS=1` into `apps/site/node_modules/.cache/preview`, and a second Playwright `webServer` serves it through the same Worker on port 8791. That project runs axe on `/til` and each note in both themes at both sizes, the 320 px check, the long code line (a block that scrolls inside itself, keyboard-focusable, without widening the page), the stacked page (full bodies, newest first, date and permalink), feeds with entries (validator rules, ids, and no note in the writing feeds), search with the TIL title, and `index.txt`. It depends on the seed note `brace-group-pipe-to-sh` for the long line.

## Consequences

- Adding a note is adding a file. Publishing is removing `draft: true`.
- `/til` grows with every note and has no pagination. At a few lines each that is fine for a long while; a note count in the hundreds would need a split by year.
- Heading and footnote ids on `/til` are `<slug>-<id>`, so a link to a heading in a note must still be written as the bare heading slug (`#example`); the pass rewrites it. An id typed in raw HTML in a note is prefixed too.
- `just e2e` builds the site a second time (about a second of Astro plus Pagefind).
- A feed reader sees a note's first paragraph, not its full text; the link goes to the note.
