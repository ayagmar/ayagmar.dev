# 0015. Data modes for the site build

Status: accepted, 2026-10-26. Not implemented yet; the data layer lands with the pull adapters.

## Context

The site reads snapshots at build time. Local development and tests must not depend on the live API, and a broken API must never break a deploy.

## Decision

- `SIGNALS_MODE=fixtures|api`. `fixtures` (the local default) reads the snapshots in `packages/contracts/fixtures/`; `api` (set in Workers Builds) reads `https://api.ayagmar.dev/v1/<source>`.
- In `api` mode each read has a 5 second deadline and is validated against the envelope and the source's schema. A failed, slow or invalid response logs a warning and the page renders its empty state. The build never fails on source data.
- The now-playing island fetches `/v1/listening` from the browser (allowed by `connect-src` in ADR 0019) and is disabled in `fixtures` mode.

## Consequences

Until the data layer exists, `/projects` and `/stats` render their empty states.
