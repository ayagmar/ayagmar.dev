# 0015. Data modes for the site build

Status: accepted, 2026-10-26. Amended 2026-10-26: weather is read by the browser only (ADR 0029).

## Context

The site reads snapshots at build time. Local development and tests must not depend on the live API, and a broken API must never break a deploy.

## Decision

- `SIGNALS_MODE=fixtures|api` and `SIGNALS_API_BASE` (default `https://api.ayagmar.dev`), read through `astro:env`. `fixtures` reads the `ok` snapshots in `packages/contracts/fixtures/`; `api` reads `${SIGNALS_API_BASE}/v1/<source>`.
- `just site-build` picks `api` when Workers Builds builds `main` (`WORKERS_CI_BRANCH=main`) and `fixtures` everywhere else: locally, in CI, and for Previews, which therefore never depend on the production API. Setting `SIGNALS_MODE` overrides it.
- The reader is `apps/site/src/data/reader.ts`. In `api` mode each read has a 5 second deadline covering the body, and the response is validated with the source's envelope schema from `contracts`. A failed, slow, non-JSON or invalid response logs one warning naming the URL and the reason, never the body, and the page renders its empty state. The build never fails on source data. Each source is read once per build.
- `stale` is recomputed at render time from `fetchedAt` with the per-source threshold in `contracts`, whatever the API said. Pages show freshness computed at build time ("Updated 3 hours ago."), plus "this may be out of date" when stale. In `fixtures` mode, which also builds the public Previews, the envelopes are dated when the fixtures were captured (`fixturesCapturedAt`) and the freshness line reads "Sample data (fixtures mode).", since the shipping fixtures are invented.
- The now-playing island (`src/components/NowPlaying.svelte`, `client:visible`) renders the build-time value first, labelled with its UTC time ("as of 26 Oct, 09:00 UTC"), so a page built hours ago does not claim the track is playing now. In `api` mode it fetches `/v1/listening` on hydration and every minute while the page is visible, allowed by `connect-src` (ADR 0019). It shows "Now playing" only for a response with `stale: false`; on any error it keeps what it shows. It links only to `https://www.last.fm/` and loads nothing else. It has no animation, so reduced motion needs no special case. In `fixtures` mode it never fetches. `connect-src` allows only `https://api.ayagmar.dev`, so with another `SIGNALS_API_BASE` the build reads work but the browser blocks the island's fetch, and it keeps the build-time value.
- Weather is the exception to build-time reads (ADR 0029): the build never reads `/v1/weather` and no page renders it, since a condition read at build time would stay on the page until the next merge. In `api` mode the home page's `.scene` carries `data-weather-src="${SIGNALS_API_BASE}/v1/weather"` and the room script reads it in the browser; in `fixtures` mode there is no attribute, no request and no weather, and no sample weather is shown as current.
- `llm-usage` and `shelf` render their empty state from `emptyEnvelope()` until their schemas exist.

## Consequences

A deploy whose build ran while signals was down shows empty sections until the next build. The site is rebuilt only on merges to `main`, so build-time numbers age; the freshness line says by how much.
