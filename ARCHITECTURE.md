# Architecture

## Units

```
apps/site            Astro static site + a Worker that only answers `/` for terminal clients.
                     Renders snapshots. Knows no data source and no signals internals.
apps/signals         Hono Worker on api.ayagmar.dev. Pulls sources on a cron, accepts pushes,
                     serves the latest snapshot per source. Knows no pages.
packages/contracts   zod schemas for every snapshot, push payload and the response envelope,
                     their JSON Schema export, and the shared test fixtures.
content/             Posts in Markdown. Data for the site, not code.
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

`data` is `null` until a source succeeds once. `stale` is computed when the response is served, by `isStale(lastSuccessAt, threshold, now)` with the per-source threshold in `packages/contracts/src/sources.ts`. If signals is down or a response fails validation, the site build still succeeds and renders an empty state.

As of this scaffold only `/v1/health` exists, the site pages show empty states, and no adapter or intake route is registered.

## Where things live

| Concern                                                                   | Place                                                                                         |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Source ids, stale thresholds, envelope, `isStale`                         | `packages/contracts/src/{sources,envelope}.ts`                                                |
| Snapshot and push schemas (one file per source)                           | `packages/contracts/src/snapshots/`, `src/push/`                                              |
| JSON Schema for producers and consumers                                   | `packages/contracts/schema/*.{input,output}.json`, written by `just contracts-schema`         |
| Payload corpus checked by zod and JSON Schema; frozen v1 consumer schemas | `packages/contracts/corpus/<schema>/{accept,reject}/`, `packages/contracts/test/frozen/v1/`   |
| Test fixtures                                                             | `packages/contracts/fixtures/<source>/{raw,snapshot}/<case>.json`                             |
| Pull adapter interface and registry                                       | `apps/signals/src/adapters/types.ts`, `src/adapters/pull/index.ts`                            |
| Snapshot storage interface                                                | `apps/signals/src/storage/types.ts`                                                           |
| Read API routes (one file per route)                                      | `apps/signals/src/routes/v1/`                                                                 |
| Error responses (JSON 404, generic 500)                                   | `apps/signals/src/errors.ts`                                                                  |
| Post frontmatter schema                                                   | `apps/site/src/lib/writing-schema.ts`                                                         |
| Post list, tags, drafts                                                   | `apps/site/src/lib/writing.ts`, `src/lib/posts.ts`                                            |
| RSS and Atom (one model, two renderers)                                   | `apps/site/src/lib/feed.ts`                                                                   |
| Mermaid diagrams in posts (build-time SVG, `/diagrams.css`)               | `apps/site/src/lib/markdown/diagrams.ts`, `src/pages/diagrams.css.ts`                         |
| Plain-text home page (`dist/index.txt`)                                   | `apps/site/src/lib/plaintext.ts`                                                              |
| Security headers and CSP                                                  | `apps/site/src/lib/security-headers.ts`, written to `dist/_headers` by `scripts/postbuild.ts` |
| Search island                                                             | `apps/site/src/components/Search.svelte` (Pagefind index built after `astro build`)           |
| Site Worker (terminal check on `/`)                                       | `apps/site/worker/index.ts`                                                                   |
| Site identity and navigation                                              | `apps/site/src/lib/site.ts`                                                                   |
| Base stylesheet                                                           | `apps/site/src/styles/base.css`                                                               |
| Commands                                                                  | `justfile`                                                                                    |
| Decisions                                                                 | `docs/adr/`                                                                                   |

## Site build

`just site-build` runs three steps:
1. `astro build` writes static HTML (one file per page, `/writing` is `writing.html`), the feeds, `index.txt` and the sitemap.
2. `pagefind --site dist` indexes the elements marked `data-pagefind-body` (post bodies) into `dist/pagefind/`.
3. `scripts/postbuild.ts` hashes Astro's own inline scripts and style, fails on any other inline script or style, and writes `dist/_headers` with one Content-Security-Policy for the whole site.

In production, Workers static assets serve `dist/`. The site Worker runs only for `/`: a `curl`, `wget`, HTTPie or `xh` user agent gets `index.txt`, anything else gets `index.html`. Both responses come from the assets binding, so they carry the `_headers` rules, plus `Vary: User-Agent`.
