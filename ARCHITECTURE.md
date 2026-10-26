# Architecture

## Units

```
apps/site            Astro static site + a Worker that only answers `/` for terminal clients.
                     Renders snapshots. Knows no data source and no signals internals.
apps/signals         Hono Worker on api.ayagmar.dev. Pulls sources on a cron, accepts pushes,
                     serves the latest snapshot per source. Knows no pages.
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
 repo-pulse            ───────►                            ├─► D1: latest  ─► GET /v1/<source>
 llm-usage-metrics,      push    intake ─ auth ─ validate ─┘   snapshot          │
 trellis               ───────►                                per source        │
                                                                                 ▼
                                                     build: astro build reads /v1/* (or fixtures)
                                                     browser: now-playing island reads /v1/listening
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

The read routes, `/v1/health`, both push routes and the cron are in place ([ADR 0010](docs/adr/0010-storage-d1.md), [ADR 0011](docs/adr/0011-push-intake-security.md)). The cron runs the pull adapters for listening (Last.fm), shipping (repo-pulse) and projects (GitHub and npm), one per invocation ([ADR 0009](docs/adr/0009-pull-adapters.md)). Locally and in Previews the site renders the shared fixtures (ADR 0015).

A push goes through, in order: content type, a 64 KiB streamed body cap, token (and for trellis an HMAC over timestamp and body), the wire schema, a delivery-id lookup, the rate limiter, a freshness window, the allowlist projection, and one D1 batch that stores the snapshot and the delivery together or neither.

## Where things live

| Concern                                                                   | Place                                                                                                         |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Source ids, stale thresholds, envelope, `isStale`                         | `packages/contracts/src/{sources,envelope}.ts`                                                                |
| Snapshot and push schemas (one file per source)                           | `packages/contracts/src/snapshots/`, `src/push/`                                                              |
| JSON Schema for producers and consumers                                   | `packages/contracts/schema/*.{input,output}.json`, written by `just contracts-schema`                         |
| Payload corpus checked by zod and JSON Schema; frozen v1 consumer schemas | `packages/contracts/corpus/<schema>/{accept,reject}/`, `packages/contracts/test/frozen/v1/`                   |
| Featured projects (slug, repo, npm package), shared by site and signals   | `packages/contracts/src/projects.ts`                                                                          |
| Test fixtures                                                             | `packages/contracts/fixtures/<upstream>/raw/`, `fixtures/<source>/snapshot/`, registered in `src/fixtures.ts` |
| Push bodies (corpus and Worker test fixtures in one)                      | `packages/contracts/fixtures/<producer>/push/{accept,reject}/`                                                |
| MSW handlers built from the fixtures (tests only)                         | `packages/contracts/src/testing.ts` (`@min7/contracts/testing`)                                               |
| Producer guides, push secrets and rotation                                | `docs/producers/`, `docs/operations.md`                                                                       |
| Pull adapter interface and registry                                       | `apps/signals/src/adapters/types.ts`, `src/adapters/pull/index.ts`                                            |
| Pull adapters, bounded upstream reads, `PullError`                        | `apps/signals/src/adapters/pull/`                                                                             |
| Snapshot storage interface and its D1 implementation                      | `apps/signals/src/storage/{types,d1}.ts`, schema in `apps/signals/migrations/`                                |
| Push admission (replay, interval, ordering in one D1 batch)               | `apps/signals/src/storage/admission.ts`                                                                       |
| Push intake: body cap, auth order, projection per producer                | `apps/signals/src/intake/`                                                                                    |
| Public labels for habit and agent ids                                     | `apps/signals/src/intake/public-labels.ts`                                                                    |
| Token and HMAC checks, CORS, structured logs                              | `apps/signals/src/security/`                                                                                  |
| Cron runner (one due adapter per run, delivery cleanup)                   | `apps/signals/src/cron/run.ts`                                                                                |
| Read API routes (one file per route), edge cache                          | `apps/signals/src/routes/v1/`, `routes/v1/snapshot.ts`                                                        |
| Error responses (JSON 404, generic 500)                                   | `apps/signals/src/errors.ts`                                                                                  |
| Post frontmatter schema                                                   | `apps/site/src/lib/writing-schema.ts`                                                                         |
| Post list, tags, drafts                                                   | `apps/site/src/lib/writing.ts`, `src/lib/posts.ts`                                                            |
| Project frontmatter schema; project model, post counts and cross-links    | `apps/site/src/lib/project-schema.ts`, `src/lib/projects.ts` (ADR 0025)                                       |
| RSS and Atom (one model, two renderers)                                   | `apps/site/src/lib/feed.ts`                                                                                   |
| Mermaid diagrams in posts (build-time SVG, `/diagrams.css`)               | `apps/site/src/lib/markdown/diagrams.ts`, `src/pages/diagrams.css.ts`                                         |
| Plain-text home page (`dist/index.txt`)                                   | `apps/site/src/lib/plaintext.ts`                                                                              |
| Security headers and CSP                                                  | `apps/site/src/lib/security-headers.ts`, written to `dist/_headers` by `scripts/postbuild.ts`                 |
| Build-time snapshot reader (`fixtures` or `api` mode), freshness          | `apps/site/src/data/`                                                                                         |
| Now-playing island                                                        | `apps/site/src/components/NowPlaying.svelte`                                                                  |
| Search island                                                             | `apps/site/src/components/Search.svelte` (Pagefind index built after `astro build`)                           |
| Site Worker (terminal check on `/`)                                       | `apps/site/worker/index.ts`                                                                                   |
| Site identity and navigation                                              | `apps/site/src/lib/site.ts`                                                                                   |
| About page and resume data, its schema                                    | `content/about.json`, `apps/site/src/data/about.ts`                                                           |
| Resume PDF (Typst template, build and ship scripts)                       | `resume/resume.typ`, `apps/site/scripts/{resume,ship-resume}.ts`                                              |
| Design tokens, type, panels, both themes (ADR 0026)                       | `apps/site/src/styles/base.css`, fonts in `src/fonts/` (built by `scripts/fonts.py`)                          |
| Theme switch (blocking script in `<head>`)                                | `apps/site/src/scripts/theme.js`, `src/components/ThemeSwitch.astro`                                          |
| Home page room: scene, hotspots, list                                     | `apps/site/src/lib/room.ts`, `src/styles/room.css`, `src/assets/room-*.png` (drawn by `scripts/scene.py`)     |
| Room clock: sun, moon, Casablanca time (ADR 0027)                         | `apps/site/src/lib/sky.ts`, `src/scripts/room.ts`, `src/assets/window-*.png`                                  |
| Per-post art (ADR 0027)                                                   | `apps/site/src/lib/art.ts`, golden files in `test/golden/`                                                    |
| Commands                                                                  | `justfile`                                                                                                    |
| Decisions                                                                 | `docs/adr/`                                                                                                   |

## Site build

`just site-build` runs these steps:
1. `just resume` validates `content/about.json` and compiles `resume/resume.typ` into `resume/build/resume.pdf` with Typst.
2. `astro build` writes static HTML (one file per page, `/writing` is `writing.html`), the feeds, `index.txt` and the sitemap.
3. `pagefind --site dist` indexes the elements marked `data-pagefind-body` (post bodies) into `dist/pagefind/`.
4. `scripts/postbuild.ts` hashes Astro's own inline scripts and style, fails on any other inline script or style, and writes `dist/_headers` with one Content-Security-Policy for the whole site.
5. `scripts/ship-resume.ts` copies the PDF (or `resume/override.pdf`) to `dist/resume.pdf` only when `resume.published` is `true`.

In production, Workers static assets serve `dist/`. The site Worker runs only for `/`: a `curl`, `wget`, HTTPie or `xh` user agent gets `index.txt`, anything else gets `index.html`. `index.txt` starts with the room in ASCII. Both responses come from the assets binding, so they carry the `_headers` rules, plus `Vary: User-Agent`.
