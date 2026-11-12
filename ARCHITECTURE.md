# Architecture

## Units

```
apps/site            Astro static site + a Worker that answers terminal clients and agents.
                     Renders snapshots. Knows no data source and no signals internals.
apps/signals         Hono Worker on api.ayagmar.dev. Pulls sources on a cron, accepts pushes,
                     serves the latest snapshot per source and daily history per series.
                     Knows no pages.
packages/contracts   zod schemas for every snapshot, push payload and the response envelope,
                     their JSON Schema export, and the shared test fixtures.
content/             Posts, optional project descriptions and the Noctalia plugins list. Data for the site, not code.
```

Dependencies point one way:

```
apps/site ──────► packages/contracts ◄────── apps/signals
```

`contracts` depends on neither app, and the apps never depend on each other. `just boundaries` (`scripts/check-boundaries.ts`) enforces this on package manifests, tsconfig references and path aliases, and every import, re-export and dynamic import in source, `.astro` and `.svelte` files included. A unit reaches `contracts` by its package name only, never by a relative path. pnpm's strict `node_modules` adds a second guard: an undeclared workspace package does not resolve.

The site and signals deploy as two separate Workers. Either can ship, roll back or break without the other.

## Data flow

```
 producers                       signals (api.ayagmar.dev)              site (ayagmar.dev)
 ─────────                       ─────────────────────────              ──────────────────
 Last.fm, GitHub, npm,   cron    pull adapter ─ normalize ─┐
 repo-pulse, Open-Meteo,                                   │
 Monkeytype             ──────►                            ├─► D1: latest  ─► GET /v1/<source>
 llm-usage-metrics,      push    intake ─ auth ─ validate ─┘   snapshot          │
 trellis, desktop      ───────►                                per source        │
                                                               + daily rows  ─► GET /v1/days/<series>
                                                               per series        │   (ADR 0038)
                                                                                 ▼
                                                     build: astro build reads /v1/* (or fixtures),
                                                            the shipping strip /v1/days/shipping-activity
                                                     browser: room script reads /v1/listening
                                                              and /v1/weather,
                                                              /stats script reads /v1/listening,
                                                              /v1/shipping, /v1/projects,
                                                              /v1/monkeytype,
                                                              /v1/listening-history and
                                                              /v1/llm-usage, /uses script reads
                                                              /v1/desktop and /v1/llm-usage,
                                                              project script reads /v1/projects
                                                              and /v1/project-events,
                                                              room scrub reads /v1/days/* by
                                                              month, once a reader moves it,
                                                     site Worker: /room reads /v1/listening and
                                                              /v1/shipping, kept a minute
```

Every read API response is an envelope from `contracts`:

```json
{
  "source": "listening",
  "version": 1,
  "fetchedAt": "2026-10-26T09:00:00Z",
  "stale": false,
  "data": {}
}
```

`data` is `null` until a source succeeds once. `stale` is computed when the response is served, by `isStale(fetchedAt, threshold, now)` with the per-source threshold in `packages/contracts/src/sources.ts`. `fetchedAt` is the fetch time for pulled sources and the producer's `sentAt` for pushed ones. If signals is down or a response fails validation, the site build still succeeds and renders an empty state.

The read routes, `/v1/health`, the three push routes (llm-usage, trellis, desktop) and the cron are in place ([ADR 0010](docs/adr/0010-storage-d1.md), [ADR 0011](docs/adr/0011-push-intake-security.md)). The cron runs the pull adapters for listening (Last.fm), shipping (repo-pulse), projects (GitHub and npm), weather (Open-Meteo), monkeytype, the listening history behind "On this day" (Last.fm, one past year per invocation), shipping activity (repo-pulse's daily activity) and each featured project's latest releases and merged pull requests (one GitHub GraphQL request, hourly), one adapter per invocation ([ADR 0009](docs/adr/0009-pull-adapters.md), [ADR 0029](docs/adr/0029-rabat-weather-in-the-window.md), [ADR 0030](docs/adr/0030-on-this-day-in-listening.md), [ADR 0038](docs/adr/0038-daily-history.md), [ADR 0046](docs/adr/0046-project-logs-from-github.md)).

Daily history ([ADR 0038](docs/adr/0038-daily-history.md)): the `daily` D1 table keeps one row per series per calendar day, for good. The shipping-activity pull writes its days in the same batch as its snapshot, the llm-usage push its newest 35 days in the same batch as its delivery; a shipping day keeps, per repository and count, the most any answer gave, and an llm-usage day is only replaced by a newer report with at least as many tokens. `GET /v1/days/<series>?month=YYYY-MM` or `?last=28` serves a block as a contract envelope. The listening pull adds today's and yesterday's range totals in the first minutes of each hour, and each weather pull offers its reading to the day's two slots, in `Africa/Casablanca`; these are day summaries with their own merge rules, which the room's scrub reads, and `src/cron/backfill.ts` fills past days of both on cron turns of its own, without touching their snapshots. `/v1/health` shows under `days` whether each is recording, apart from the source's own health. The home page and /stats draw the shipping strip from it at build, outlining days without a record. The site build also reads every `?month=` block of both series once (`readHistory`), and `apps/site/src/lib/days.ts` turns that history and the published writing into a `noindex` page per date at `/day/YYYY-MM-DD` (the strip's squares link to them), a receipt line on each project page, and one on each post whose frontmatter has a `receipts` range. `apps/site/src/lib/years.ts` turns the same reads into a page per year at `/YYYY` ([ADR 0041](docs/adr/0041-year-pages.md)). A series with a month that failed to load counts as unknown, never as a shorter history; a year page leaves out only that year's totals for that series. Locally and in Previews the site renders the shared fixtures (ADR 0015).

A push goes through, in order: content type, a 64 KiB streamed body cap, token (and for trellis an HMAC over timestamp and body), the wire schema, a delivery-id lookup, the rate limiter, a freshness window, the allowlist projection, and one D1 batch that stores the snapshot and the delivery together or neither.

## Where things live

| Concern                                                                   | Place                                                                                                                                              |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source ids, stale thresholds, envelope, `isStale`                         | `packages/contracts/src/{sources,envelope}.ts`                                                                                                     |
| Snapshot and push schemas (one file per source)                           | `packages/contracts/src/snapshots/`, `src/push/`                                                                                                   |
| JSON Schema for producers and consumers                                   | `packages/contracts/schema/*.{input,output}.json`, written by `just contracts-schema`                                                              |
| Payload corpus checked by zod and JSON Schema; frozen v1 consumer schemas | `packages/contracts/corpus/<schema>/{accept,reject}/`, `packages/contracts/test/frozen/v1/`                                                        |
| Featured projects (slug, repo, npm package, `pull`), site and signals     | `packages/contracts/src/projects.ts`                                                                                                               |
| Test fixtures                                                             | `packages/contracts/fixtures/<upstream>/raw/`, `fixtures/<source>/snapshot/`, `fixtures/<series>/{days,history}/`, registered in `src/fixtures.ts` |
| Push bodies (corpus and Worker test fixtures in one)                      | `packages/contracts/fixtures/<producer>/push/{accept,reject}/`                                                                                     |
| MSW handlers built from the fixtures (tests only)                         | `packages/contracts/src/testing.ts` (`@min7/contracts/testing`)                                                                                    |
| Producer guides, push secrets and rotation                                | `docs/producers/`, `docs/operations.md`                                                                                                            |
| Producers on the owner's machine: delivery, llm-usage, desktop (ADR 0032) | `producers/*.ts`, systemd units in `producers/systemd/`                                                                                            |
| Pull adapter interface and registry                                       | `apps/signals/src/adapters/types.ts`, `src/adapters/pull/index.ts`                                                                                 |
| Pull adapters, bounded upstream reads, `PullError`                        | `apps/signals/src/adapters/pull/`                                                                                                                  |
| Snapshot storage interface and its D1 implementation                      | `apps/signals/src/storage/{types,d1}.ts`, schema in `apps/signals/migrations/`                                                                     |
| Daily history: series, zones, blocks; writes and reads; route (ADR 0038)  | `packages/contracts/src/days.ts`, `apps/signals/src/storage/daily.ts`, `src/routes/v1/days.ts`                                                     |
| Listening's read cadences and carried parts (ADR 0009)                    | `apps/signals/src/adapters/pull/listening.ts`                                                                                                      |
| Listening and weather days: reads, merge rules, backfill (ADR 0038)       | `apps/signals/src/adapters/pull/{listening-days,weather-days}.ts`, `src/cron/backfill.ts`                                                          |
| Shipping strip: history or event fallback, caption (ADR 0038)             | `apps/site/src/data/format.ts` (`shippingStrip`), `src/components/ShippingHeat.astro`                                                              |
| Day pages and receipts: what a date, project or post range counted        | `apps/site/src/lib/days.ts`, `src/data/reader.ts` (`readHistory`), `src/pages/day/[date].astro`                                                    |
| Year pages: calendar, facts, usage by month (ADR 0041)                    | `apps/site/src/lib/years.ts`, `src/pages/[year].astro`, `src/components/{HeatDay,YearFacts}.astro`                                                 |
| Heat levels of every heat view, their ramp (ADR 0037)                     | `apps/site/src/lib/heat.ts`, `--heat-1` to `--heat-4` in `src/styles/base.css`                                                                     |
| Push admission (replay, interval, ordering in one D1 batch)               | `apps/signals/src/storage/admission.ts`                                                                                                            |
| Push intake: body cap, auth order, projection per producer                | `apps/signals/src/intake/`                                                                                                                         |
| Public labels for habit and agent ids                                     | `apps/signals/src/intake/public-labels.ts`                                                                                                         |
| Token and HMAC checks, CORS, structured logs                              | `apps/signals/src/security/`                                                                                                                       |
| Cron runner (one due adapter or backfill date per run, delivery cleanup)  | `apps/signals/src/cron/run.ts`                                                                                                                     |
| Read API routes (one file per route), edge cache                          | `apps/signals/src/routes/v1/`, `routes/v1/snapshot.ts`                                                                                             |
| Error responses (JSON 404, generic 500)                                   | `apps/signals/src/errors.ts`                                                                                                                       |
| Post frontmatter schema                                                   | `apps/site/src/lib/writing-schema.ts`                                                                                                              |
| Post list, tags, drafts                                                   | `apps/site/src/lib/writing.ts`, `src/lib/posts.ts`                                                                                                 |
| TIL notes: schema, model, summary, page and feeds (ADR 0028)              | `apps/site/src/lib/{til-schema,til}.ts`, `src/pages/til/`, `src/components/TilNote.astro`                                                          |
| Project frontmatter schema; project model, post counts and cross-links    | `apps/site/src/lib/project-schema.ts`, `src/lib/projects.ts` (ADR 0025); numbers and log in `src/lib/project-panel.ts`                             |
| Project logs: GitHub GraphQL pull, frontier, bots left out (ADR 0046)     | `apps/signals/src/adapters/pull/project-events.ts`, `packages/contracts/src/snapshots/project-events.ts`                                           |
| Noctalia plugins on /projects: data and schema (ADR 0047)                 | `content/noctalia-plugins.json`, `apps/site/src/lib/noctalia-plugins.ts`                                                                           |
| Certification badges and plugin thumbnails (ADR 0048)                     | `apps/site/src/lib/content-images.ts`, `src/assets/{badges,plugins}/`                                                                              |
| Project screenshots (ADR 0049)                                            | `content/project-screenshots.json`, `apps/site/src/lib/project-screenshot.ts`, `src/components/ProjectShot.astro`                                  |
| Image viewer for screenshots (ADR 0049)                                   | `apps/site/src/components/{Viewable,ImageViewer}.astro`, `src/scripts/image-viewer.ts`                                                             |
| RSS and Atom (one model, two renderers; writing and TIL)                  | `apps/site/src/lib/feed.ts`                                                                                                                        |
| Mermaid diagrams in posts (build-time SVG, `/diagrams.css`)               | `apps/site/src/lib/markdown/diagrams.ts`, `src/pages/diagrams.css.ts`                                                                              |
| Copy buttons on code blocks in posts and notes                            | `apps/site/src/lib/markdown/code-copy.ts`, `src/scripts/code-copy.ts`                                                                              |
| Text and Markdown copies of pages, /llms.txt (ADR 0040)                   | `apps/site/src/lib/{plaintext,article,stats-text,llms}.ts`, `src/pages/**/*.{txt,md}.ts`                                                           |
| Security headers and CSP                                                  | `apps/site/src/lib/security-headers.ts`, written to `dist/_headers` by `scripts/postbuild.ts`                                                      |
| Build-time snapshot reader (`fixtures` or `api` mode)                     | `apps/site/src/data/`                                                                                                                              |
| Live panels in the browser: polling, answer checks, relative times        | `apps/site/src/lib/{live,live-page}.ts`, readers in `src/lib/{listening,stats}.ts`, `src/scripts/{room,stats-live,project-live}.ts`                |
| Markup both the build and the browser render; Last.fm links               | `apps/site/src/lib/{markup,markup-page,now-playing-page}.ts`, `src/components/Markup.astro`, `src/lib/{listening-panel,lastfm}.ts`                 |
| Search island                                                             | `apps/site/src/components/Search.svelte` (Pagefind index built after `astro build`)                                                                |
| Site Worker (which copy a request gets, ADR 0040)                         | `apps/site/worker/index.ts`                                                                                                                        |
| The room in a terminal: frames, words, live answers (ADR 0045)            | `apps/site/src/lib/terminal-room.ts`, `src/pages/terminal/`, `worker/room.ts`                                                                      |
| Site identity and navigation                                              | `apps/site/src/lib/site.ts`                                                                                                                        |
| About page data, its schema                                               | `content/about.json`, `apps/site/src/data/about.ts`                                                                                                |
| Skills shelf: data, schema, sync script, page (ADR 0031)                  | `content/skills.json`, `apps/site/src/lib/{skills-schema,skills}.ts`, `src/pages/skills.astro`, `scripts/skills-sync.ts`                           |
| Design tokens, type, panels, both themes (ADR 0026)                       | `apps/site/src/styles/base.css`, fonts in `src/fonts/` (built by `scripts/fonts.py`)                                                               |
| Theme switch (blocking script in `<head>`)                                | `apps/site/src/scripts/theme.js`, `src/components/ThemeSwitch.astro`                                                                               |
| Page changes, cross-document view transitions (ADR 0042)                  | `apps/site/src/styles/base.css`, last rules before the reduced-motion block; `src/scripts/theme.js`                                                |
| The room's model: every fact it says, for each renderer (ADR 0043)        | `apps/site/src/lib/{room-clock,room-state,room-markup}.ts`, `src/lib/room-seed.ts`, `src/data/room.ts`                                             |
| The room through past days: facts, control, loading (ADR 0044)            | `apps/site/src/lib/{room-day,room-scrub}.ts`, `src/scripts/room-scrub.ts`, `src/pages/day/index.json.ts`, `src/pages/sample/days/`                 |
| Home page room: scene, hotspots, list                                     | `apps/site/src/lib/room.ts`, `src/styles/room.css`, `src/assets/room-*.png` (drawn by `scripts/scene.py`)                                          |
| Room clock: sun, moon, Rabat time, the late cat (ADR 0027)                | `apps/site/src/lib/sky.ts`, `src/scripts/room.ts`, `src/assets/{window,cat}-*.png`                                                                 |
| Contact sheet of every room state, never shipped (`just room-states`)     | `apps/site/scripts/room-states.ts`, written to `apps/site/.room-states/`                                                                           |
| Weather in the window: code table, art (ADR 0029)                         | `packages/contracts/src/weather-codes.ts`, `apps/site/src/lib/weather.ts`, `src/scripts/room.ts`, `src/assets/weather-*.png`                       |
| On this day: Rabat dates, history check (ADR 0030)                        | `packages/contracts/src/rabat.ts`, `apps/site/src/lib/history.ts`, `src/scripts/history.ts`                                                        |
| Browser reads on /stats and /uses: freshness, LLM usage, desktop facts    | `apps/site/src/lib/{live,live-page,llm-usage,llm-usage-panel,stats-panels,markup,desktop}.ts`, `src/scripts/{stats-live,uses}.ts`                  |
| /uses page data, its schema (ADR 0032)                                    | `content/uses.json`, `apps/site/src/data/uses.ts`, `apps/site/src/pages/uses.astro`                                                                |
| Per-post art (ADR 0027)                                                   | `apps/site/src/lib/art.ts`, `art-files.ts`, maps in `src/art/`, [docs/art.md](docs/art.md)                                                         |
| Favicon, touch icon and link-preview images (ADR 0027)                    | `apps/site/public/favicon.svg`, `src/lib/{og,og-card}.ts`, `src/pages/og/`, `src/pages/{favicon.ico,apple-touch-icon.png}.ts`                      |
| Performance budgets (numbers), static check, Lighthouse run and comment   | `scripts/budgets.json`, `scripts/budgets.ts`, `scripts/lighthouse.ts`, `scripts/lighthouse-report.js`                                              |
| Commands                                                                  | `justfile`                                                                                                                                         |
| Decisions                                                                 | `docs/adr/`                                                                                                                                        |

## Site build

`just site-build` runs these steps:

1. `astro build` writes static HTML (one file per page, `/writing` is `writing.html`), the text and Markdown copies, `llms.txt`, the feeds, the sitemap, the icons and a link-preview PNG for each post, note and year page plus one for every other page.
2. `pagefind --site dist` indexes the elements marked `data-pagefind-body` into `dist/pagefind/`: posts, notes, each project's name, tagline and description, the Noctalia plugins on /projects, /about, /uses, /now and /skills. Pages other than posts set their result title with `data-pagefind-meta`; posts use their h1. /now's date, /uses' live panel, /about's links and the skills' badges, links and install details are `data-pagefind-ignore`. A project page indexes only its header and description.
3. `scripts/postbuild.ts` hashes Astro's own inline scripts and style, fails on any other inline script or style, and writes `dist/_headers` with one Content-Security-Policy for the whole site.

In production, Workers static assets serve `dist/`. The site Worker runs only for the pages with a copy ([ADR 0040](docs/adr/0040-text-and-markdown-copies.md)): a request whose `Accept` prefers Markdown gets the page's `.md` or else its `.txt`, a `curl`, `wget`, HTTPie or `xh` user agent its `.txt`, anything else the HTML page. `index.txt` starts with the room in ASCII. Every response comes from the assets binding, so it carries the `_headers` rules, plus `Vary: Accept, User-Agent`. The `.md` and `.txt` URLs themselves are plain assets, marked `noindex`. `/room` is the one answer the Worker renders: a terminal client gets the room in truecolor with the sky, the track and the latest commit as they are now, anyone else a redirect to `/` ([ADR 0045](docs/adr/0045-truecolor-room.md)). A page that moved gets a 301 from the Worker's `moved` map, and a moved copy, which never reaches the Worker, one from `public/_redirects` ([ADR 0047](docs/adr/0047-noctalia-plugins-on-projects.md)).
