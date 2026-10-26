# 0008. Contracts: zod schemas as the source, JSON Schema generated

Status: accepted, 2026-10-26

## Context

Producers are written in TypeScript (llm-usage-metrics) and Kotlin (trellis); consumers are the site build and its browser island. All of them must agree on shapes without importing each other's code.

## Decision

- `packages/contracts` holds zod 4 schemas: the envelope (`src/envelope.ts`), source ids and stale thresholds (`src/sources.ts`), one file per source under `src/snapshots/` and per producer under `src/push/`, each folder with a barrel `index.ts`, all re-exported from `src/index.ts`.
- Every read API response is `{ source, version: 1, fetchedAt, stale, data }`, built by `envelopeSchema(source, data)`. `fetchedAt` is an RFC 3339 timestamp with offset, or `null`; `data` is `null` until the source has succeeded once.
- `stale` is computed when a response is served by `isStale(lastSuccessAt, thresholdSeconds, now)`: stale when the source never succeeded, when the timestamp is unreadable, or when more than the threshold has passed. Thresholds per source are in `staleAfterSeconds`, a few missed updates of each source's schedule.
- `scripts/export-schema.ts` writes `schema/<name>.input.json` (zod `io: "input"`, for producers) and `schema/<name>.output.json` (for consumers) for every schema listed in `src/json-schemas.ts`. The files are committed; `just contracts-schema` writes them and `just contracts-schema-check` fails when they are stale or orphaned.
- Changes within v1 are additive. Zod consumers strip unknown fields, so they keep working. The output JSON Schema describes exactly what v1 emits now (`additionalProperties: false`); consumers in other languages should ignore unknown properties rather than validate responses strictly against it. A breaking change ships a `/v2/` path next to v1, with a test that the v1 consumer still parses the new output.
- Shared fixtures live in `packages/contracts/fixtures/` (layout in its README).

## Consequences

A producer in another language validates against `schema/*.input.json` without running TypeScript. Forgetting to regenerate the schema fails CI.
