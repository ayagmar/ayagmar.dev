# 0040. Text and Markdown copies of the pages, and llms.txt

Status: accepted, 2026-11-06

## Context

`curl ayagmar.dev` and `/now` print text (ADR 0005, 0035); every other page gives a terminal a screen of HTML. Coding agents read the site too, and the posts are Markdown already. The site is static with a Worker in front of two paths, on the Workers Free plan: 100,000 requests a day for the account, shared with signals, whose every-minute cron alone takes 1,440.

## Decision

### Which pages, at which URLs

| Page                                                      | Text                       | Markdown    |
| --------------------------------------------------------- | -------------------------- | ----------- |
| `/writing/<slug>`, `/til/<slug>`                          | `<page>.txt`               | `<page>.md` |
| `/`, `/writing`, `/til`, `/projects`, `/projects/<slug>`  | `/index.txt`, `<page>.txt` | none        |
| `/about`, `/uses`, `/stats`, `/now`                       | `<page>.txt`               | none        |
| `/skills`, `/colophon`, `/day/*`, `/YYYY`, tag pages, 404 | none                       | none        |

Every copy is a file in `dist/`, built by an Astro endpoint next to its page, so a draft has no copy on production for the same reason it has no page: the endpoints read `getPosts` and `getNotes`. Markdown stops at posts and notes, the pages whose source it is; the others would need a third renderer for no gain over text. `/skills` and `/colophon` have their prose inside the `.astro` file, so a copy would be a second hand-written version. Tag and day pages are `noindex` filtered views of what the lists already say. Year pages (ADR 0041) get no copy and are not in `llms.txt`: a page is a calendar of squares, the indexed text around it is counts that `/stats.txt` and the feeds cover in part, and a copy would need a renderer over `src/lib/years.ts` and a new routed pattern, a Worker run per view, for readers nobody has asked about. `curl ayagmar.dev/2026` gets the HTML, as any page without a copy does.

### One model per page

Each copy renders what the page renders, not a retelling of it:

- Posts and notes go through `src/lib/article.ts`: `postArticle` and `noteArticle` make one model, `renderArticleText` and `renderArticleMarkdown` write it.
- `/stats` runs the panels' own markup (`src/lib/markup.ts`, what the build and the browser draw) through `markupLines` in `src/lib/stats-text.ts`. Costs stay out because the panels leave them out.
- `/about` and project pages share `aboutLinks`, `monthSpan`, `projectFacts` and `projectLinks` with their components. The words /stats shows around its numbers live in `statsWords`.

What needs the reader's clock or browser stays on the page: "On this day", the live /uses facts, the stale notice on /now, the shipping strip (its squares carry no text the list does not). The stats text is built once, so its first line says so and each panel gives the time its numbers are from; a Preview's says they are samples. Comments, the series line, receipts, post art and project cards stay on the page too.

### What a post's Markdown contains

YAML frontmatter (`title`, `author`, `date`, `updated`, `summary`, `tags`, `draft` when true, `canonical`), then `# Title`, then the body as written. Frontmatter, not a plain header, because a reader can parse it without guessing; values are JSON strings, which YAML reads, so a title with a colon or quote cannot break it.

- Links, images and link definitions are made absolute by `absoluteLinks`. The Markdown parser (`markdownToMdast`) finds each node, and the destination is read from the node's own syntax after its label, so a code sample, a title and the prose around a link stay as written. A `#fragment` goes to the HTML page, with a note's id prefix (ADR 0028). Raw HTML is left alone: `/writing/a.md` has the same base as `/writing/a`, so its relative links still resolve.
- A relative image would become a URL under the post's path. No post has one today, and `just links` scans the built `.md` files, so the first one that fails to resolve fails CI rather than an agent.
- Mermaid fences stay, since the source is the form an agent can read. Text replaces each with `[Diagram: <name>]`, its `accDescr` and the page's URL: every diagram must have a name (ADR 0024), and Mermaid source is not reading matter in a terminal.
- Code-copy buttons and heading links come from HTML passes, so neither format has them.

### How far the Worker reaches

Static asset requests are free and unlimited; each request that reaches the Worker counts against the 100,000. Measured through `wrangler dev` with a clean browser, one page load makes 8 same-origin requests on /writing, /about, /til and a project page, 12 on /uses, 13 on /stats and 16 on home.

| Option                                | Worker runs per page view | Page views a day before the limit | Terminals at the page URL |
| ------------------------------------- | ------------------------- | --------------------------------- | ------------------------- |
| Every path (`/*`)                     | 8 to 16                   | about 6,000 to 12,000             | yes                       |
| Page paths only (chosen)              | 1                         | about 98,000                      | yes                       |
| Static files, negotiation on `/` only | 0 (home 1)                | no limit for pages                | no                        |

Static files alone miss the goal: `curl .../writing/<slug>` would print HTML. Page paths cost one run per document and none for its CSS, fonts, scripts and images, and `run_worker_first` has the negative patterns to keep it that way: `!/*.md`, `!/*.txt` and `!/*.xml` keep copies and feeds under `/writing`, `/til` and `/projects` off the Worker, and `!/writing/tags/*` the tag pages. Negative patterns win whatever the order (Cloudflare's static assets docs). The rule is a glob over the whole path, so `!/*.md` covers every directory (`generateGlobOnlyRuleRegExp` in Wrangler's asset worker).

The price: a post view used to cost nothing, and past the daily limit these paths fail instead of `/` and `/now` alone, where static-only pages would go on being served (Cloudflare's billing page says such requests get a 429). A day that large is unlikely here, and home views also cost signals reads, so that budget would go first. If it happens, cutting the list in `wrangler.jsonc` back to `/` and `/now` restores today's behaviour in one line; `.txt`, `.md` and `llms.txt` keep working as files.

### Who gets what

`worker/index.ts`, on those paths:

1. `Accept` prefers Markdown: the page's `.md`, or else its `.txt`. An agent that asks for Markdown on /about wants text, not HTML.
2. A `curl`, `wget`, HTTPie or `xh` user agent (ADR 0005): the page's `.txt`.
3. Anything else, or a page with no such copy: the static page.

"Prefers" compares the two representations, each rated by the most specific range that matches it (RFC 9110 12.5.1): `text/markdown` by its own range, `text/html` by its own, else `text/*`, else `*/*`. Ranges with q=0 count, so a wildcard cannot undo an exclusion. On top of that sit two choices of this site: Markdown must be named outright, and it must win on q or tie and be listed first. Agents do send `text/markdown, text/html`; a browser never names Markdown. So `text/*;q=1, text/html;q=0.1, text/markdown;q=0.9` gets Markdown, while `*/*`, `text/*`, `text/html, text/markdown;q=0.5`, `text/*, text/markdown;q=0.9`, a missing header, garbage and a range whose q does not parse all get HTML. A terminal asking `Accept: text/html` still gets text, as it does today; `curl -A` gets the HTML.

The Worker looks a copy up by fetching it from the assets binding and falls through on a 404, so it holds no list of pages. An unknown path, a draft's slug and a trailing slash all reach the static layer as they did: 404, 404 and a 307 to the page. A 404 under a routed path is the HTML 404 page for every client, including terminals; a text 404 would apply only under the routed paths, while `/nope` never reaches the Worker. HEAD and conditional requests pass through unchanged.

### Caching

Every answer the Worker gives carries `Vary: Accept, User-Agent`, the HTML and 404s included. What each layer does, as checked in the docs and on `wrangler dev`:

- On this configuration no Cloudflare cache sits in front of the choice: the zone cache runs after a Worker, and nothing here turns on Workers Cache, the opt-in cache that can answer before a Worker runs and honours `Vary`, or caches the Worker's own output. That is a fact about this setup, not a platform guarantee, so check this section before enabling either. The variants are separate asset files, cached by their own paths (`CF-Cache-Status` differed between the HTML and the text of one URL on a Preview), so one can never be stored as the other. Cloudflare's static assets docs say nothing about `Vary`, and nothing here depends on the edge honouring it. A zone Cache Rule that caches these paths would have to be keyed on those headers, so do not add one.
- `Vary` is for browsers and other shared caches beyond Cloudflare. Assets default to `public, max-age=0, must-revalidate` with an ETag of the file's hash, so a cached copy is revalidated each time and a validator from one variant cannot match another.
- The `.md` and `.txt` URLs depend on nothing, skip the Worker and carry no such `Vary`.

### Search engines

`_headers` gives `/*.md` and `/*.txt` `X-Robots-Tag: noindex`, in one rule per pattern. The same rules set `Content-Type` with `charset=utf-8`: deployed static assets are sent as plain `text/plain` with no charset, though `wrangler dev` adds one, so a test against `wrangler dev` cannot see the difference. Previews carry `noindex` on every path from Cloudflare itself. `Link: rel="canonical"` was the alternative and would pass signals to the page, but it needs a line per file (`_headers` allows 100 rules) or a Worker run on URLs that now skip it. Copies are not linked from any page, so there is little to pass on. The rule also covers `robots.txt`, `llms.txt` and the IndexNow key: `noindex` stops a file being listed, not fetched. A negotiated answer carries it too, at the page's URL; search crawlers send neither a terminal agent nor a Markdown preference, and they are the only readers it speaks to. The sitemap lists no copy (`seo-check.ts` fails on one), and Pagefind reads HTML only.

### /llms.txt

Built by `src/lib/llms.ts` to the format at llmstxt.org: H1, summary quote, a paragraph on how the copies work, then H2 lists of `[name](url): notes`, with `Optional` for what an agent can skip. Posts and notes are `buildFeed` and `buildTilFeed` entries, so the file and the feeds list the same things. A section with nothing in it is left out. Links use `buildOrigin` (ADR 0027), so a Preview's file reaches its own drafts.

## Consequences

- Every page view on those paths runs the Worker once; `/` and `/now` no longer stand alone (ADR 0005 amended).
- A new page with a copy needs its path in `run_worker_first`; `e2e/text.spec.ts` fails for any built `.txt` a terminal cannot reach at the page URL.
- The feeds, the HTML and the search index are unchanged.
