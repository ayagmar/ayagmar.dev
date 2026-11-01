# Architecture

## Units

```
apps/site            Astro static site + a Worker that only answers `/` for terminal clients.
                     Renders snapshots. Knows no data source and no signals internals.
apps/signals         Hono Worker on api.ayagmar.dev. Pulls sources on a cron, accepts pushes,
                     serves the latest snapshot per source and daily history per series.
                     Knows no pages.
packages/contracts   zod schemas for every snapshot, push payload and the response envelope,
                     their JSON Schema export, and the shared test fixtures.
content/             Posts and optional project descriptions in Markdown. Data for the site, not code.
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
                                                     browser: home now-playing reads /v1/listening,
                                                              room script reads /v1/weather,
                                                              /stats script reads /v1/listening,
                                                              /v1/shipping, /v1/projects,
                                                              /v1/monkeytype,
                                                              /v1/listening-history and
                                                              /v1/llm-usage, /uses script reads
                                                              /v1/desktop and /v1/llm-usage
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

The read routes, `/v1/health`, the three push routes (llm-usage, trellis, desktop) and the cron are in place ([ADR 0010](docs/adr/0010-storage-d1.md), [ADR 0011](docs/adr/0011-push-intake-security.md)). The cron runs the pull adapters for listening (Last.fm), shipping (repo-pulse), projects (GitHub and npm), weather (Open-Meteo), monkeytype, the listening history behind "On this day" (Last.fm, one past year per invocation) and shipping activity (repo-pulse's daily activity), one adapter per invocation ([ADR 0009](docs/adr/0009-pull-adapters.md), [ADR 0029](docs/adr/0029-rabat-weather-in-the-window.md), [ADR 0030](docs/adr/0030-on-this-day-in-listening.md), [ADR 0038](docs/adr/0038-daily-history.md)).

Daily history ([ADR 0038](docs/adr/0038-daily-history.md)): the `daily` D1 table keeps one row per series per calendar day, for good. The shipping-activity pull writes its days in the same batch as its snapshot, the llm-usage push its newest 35 days in the same batch as its delivery; a shipping day keeps, per repository and count, the most any answer gave, and an llm-usage day is only replaced by a newer report with at least as many tokens. `GET /v1/days/<series>?month=YYYY-MM` or `?last=28` serves a block as a contract envelope. The home page and /stats draw the shipping strip from it at build, outlining days without a record. Locally and in Previews the site renders the shared fixtures (ADR 0015).

A push goes through, in order: content type, a 64 KiB streamed body cap, token (and for trellis an HMAC over timestamp and body), the wire schema, a delivery-id lookup, the rate limiter, a freshness window, the allowlist projection, and one D1 batch that stores the snapshot and the delivery together or neither.

## Where things live

| Concern                                                                   | Place                                                                                                                                    |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Source ids, stale thresholds, envelope, `isStale`                         | `packages/contracts/src/{sources,envelope}.ts`                                                                                           |
| Snapshot and push schemas (one file per source)                           | `packages/contracts/src/snapshots/`, `src/push/`                                                                                         |
| JSON Schema for producers and consumers                                   | `packages/contracts/schema/*.{input,output}.json`, written by `just contracts-schema`                                                    |
| Payload corpus checked by zod and JSON Schema; frozen v1 consumer schemas | `packages/contracts/corpus/<schema>/{accept,reject}/`, `packages/contracts/test/frozen/v1/`                                              |
| Featured projects (slug, repo, npm package), shared by site and signals   | `packages/contracts/src/projects.ts`                                                                                                     |
| Test fixtures                                                             | `packages/contracts/fixtures/<upstream>/raw/`, `fixtures/<source>/snapshot/`, `fixtures/<series>/days/`, registered in `src/fixtures.ts` |
| Push bodies (corpus and Worker test fixtures in one)                      | `packages/contracts/fixtures/<producer>/push/{accept,reject}/`                                                                           |
| MSW handlers built from the fixtures (tests only)                         | `packages/contracts/src/testing.ts` (`@min7/contracts/testing`)                                                                          |
| Producer guides, push secrets and rotation                                | `docs/producers/`, `docs/operations.md`                                                                                                  |
| Producers on the owner's machine: delivery, llm-usage, desktop (ADR 0032) | `producers/*.ts`, systemd units in `producers/systemd/`                                                                                  |
| Pull adapter interface and registry                                       | `apps/signals/src/adapters/types.ts`, `src/adapters/pull/index.ts`                                                                       |
| Pull adapters, bounded upstream reads, `PullError`                        | `apps/signals/src/adapters/pull/`                                                                                                        |
| Snapshot storage interface and its D1 implementation                      | `apps/signals/src/storage/{types,d1}.ts`, schema in `apps/signals/migrations/`                                                           |
| Daily history: series, zones, blocks; writes and reads; route (ADR 0038)  | `packages/contracts/src/days.ts`, `apps/signals/src/storage/daily.ts`, `src/routes/v1/days.ts`                                           |
| Shipping strip: history or event fallback, caption (ADR 0038)             | `apps/site/src/data/format.ts` (`shippingStrip`), `src/components/ShippingHeat.astro`                                                    |
| Push admission (replay, interval, ordering in one D1 batch)               | `apps/signals/src/storage/admission.ts`                                                                                                  |
| Push intake: body cap, auth order, projection per producer                | `apps/signals/src/intake/`                                                                                                               |
| Public labels for habit and agent ids                                     | `apps/signals/src/intake/public-labels.ts`                                                                                               |
| Token and HMAC checks, CORS, structured logs                              | `apps/signals/src/security/`                                                                                                             |
| Cron runner (one due adapter per run, delivery cleanup)                   | `apps/signals/src/cron/run.ts`                                                                                                           |
| Read API routes (one file per route), edge cache                          | `apps/signals/src/routes/v1/`, `routes/v1/snapshot.ts`                                                                                   |
| Error responses (JSON 404, generic 500)                                   | `apps/signals/src/errors.ts`                                                                                                             |
| Post frontmatter schema                                                   | `apps/site/src/lib/writing-schema.ts`                                                                                                    |
| Post list, tags, drafts                                                   | `apps/site/src/lib/writing.ts`, `src/lib/posts.ts`                                                                                       |
| TIL notes: schema, model, summary, page and feeds (ADR 0028)              | `apps/site/src/lib/{til-schema,til}.ts`, `src/pages/til/`, `src/components/TilNote.astro`                                                |
| Project frontmatter schema; project model, post counts and cross-links    | `apps/site/src/lib/project-schema.ts`, `src/lib/projects.ts` (ADR 0025)                                                                  |
| RSS and Atom (one model, two renderers; writing and TIL)                  | `apps/site/src/lib/feed.ts`                                                                                                              |
| Mermaid diagrams in posts (build-time SVG, `/diagrams.css`)               | `apps/site/src/lib/markdown/diagrams.ts`, `src/pages/diagrams.css.ts`                                                                    |
| Plain-text home page (`dist/index.txt`)                                   | `apps/site/src/lib/plaintext.ts`                                                                                                         |
| Security headers and CSP                                                  | `apps/site/src/lib/security-headers.ts`, written to `dist/_headers` by `scripts/postbuild.ts`                                            |
| Build-time snapshot reader (`fixtures` or `api` mode)                     | `apps/site/src/data/`                                                                                                                    |
| Live panels in the browser: polling, answer checks, relative times        | `apps/site/src/lib/live.ts`, readers in `src/lib/{listening,stats}.ts`, `src/scripts/{now-playing,stats-live}.ts`                        |
| Markup both the build and the browser render; Last.fm links               | `apps/site/src/lib/markup.ts`, `src/components/Markup.astro`, `src/lib/{listening-panel,lastfm}.ts`                                      |
| Search island                                                             | `apps/site/src/components/Search.svelte` (Pagefind index built after `astro build`)                                                      |
| Site Worker (terminal check on `/`)                                       | `apps/site/worker/index.ts`                                                                                                              |
| Site identity and navigation                                              | `apps/site/src/lib/site.ts`                                                                                                              |
| About page data, its schema                                               | `content/about.json`, `apps/site/src/data/about.ts`                                                                                      |
| Skills shelf: data, schema, sync script, page (ADR 0031)                  | `content/skills.json`, `apps/site/src/lib/{skills-schema,skills}.ts`, `src/pages/skills.astro`, `scripts/skills-sync.ts`                 |
| Design tokens, type, panels, both themes (ADR 0026)                       | `apps/site/src/styles/base.css`, fonts in `src/fonts/` (built by `scripts/fonts.py`)                                                     |
| Theme switch (blocking script in `<head>`)                                | `apps/site/src/scripts/theme.js`, `src/components/ThemeSwitch.astro`                                                                     |
| Home page room: scene, hotspots, list                                     | `apps/site/src/lib/room.ts`, `src/styles/room.css`, `src/assets/room-*.png` (drawn by `scripts/scene.py`)                                |
| Room clock: sun, moon, Rabat time (ADR 0027)                              | `apps/site/src/lib/sky.ts`, `src/scripts/room.ts`, `src/assets/window-*.png`                                                             |
| Weather in the window: code table, art (ADR 0029)                         | `apps/site/src/lib/weather.ts`, `src/scripts/room.ts`, `src/assets/weather-*.png`                                                        |
| On this day: Rabat dates, history check (ADR 0030)                        | `packages/contracts/src/rabat.ts`, `apps/site/src/lib/history.ts`, `src/scripts/history.ts`                                              |
| Browser reads on /stats and /uses: freshness, LLM usage, desktop facts    | `apps/site/src/lib/{live,llm-usage,llm-usage-panel,stats-panels,markup,desktop}.ts`, `src/scripts/{stats-live,uses}.ts`                  |
| /uses page data, its schema (ADR 0032)                                    | `content/uses.json`, `apps/site/src/data/uses.ts`, `apps/site/src/pages/uses.astro`                                                      |
| Per-post art (ADR 0027)                                                   | `apps/site/src/lib/art.ts`, golden files in `test/golden/`                                                                               |
| Favicon, touch icon and link-preview images (ADR 0027)                    | `apps/site/public/favicon.svg`, `src/lib/{og,og-card}.ts`, `src/pages/og/`, `src/pages/{favicon.ico,apple-touch-icon.png}.ts`            |
| Performance budgets (numbers), static check, Lighthouse run and comment   | `scripts/budgets.json`, `scripts/budgets.ts`, `scripts/lighthouse.ts`, `scripts/lighthouse-report.js`                                    |
| Commands                                                                  | `justfile`                                                                                                                               |
| Decisions                                                                 | `docs/adr/`                                                                                                                              |

## Site build

`just site-build` runs these steps:
1. `astro build` writes static HTML (one file per page, `/writing` is `writing.html`), the feeds, `index.txt`, the sitemap, the icons and a link-preview PNG for each post and note plus one for every other page.
2. `pagefind --site dist` indexes the elements marked `data-pagefind-body` (post and note bodies) into `dist/pagefind/`.
3. `scripts/postbuild.ts` hashes Astro's own inline scripts and style, fails on any other inline script or style, and writes `dist/_headers` with one Content-Security-Policy for the whole site.

In production, Workers static assets serve `dist/`. The site Worker runs only for `/`: a `curl`, `wget`, HTTPie or `xh` user agent gets `index.txt`, anything else gets `index.html`. `index.txt` starts with the room in ASCII. Both responses come from the assets binding, so they carry the `_headers` rules, plus `Vary: User-Agent`.
