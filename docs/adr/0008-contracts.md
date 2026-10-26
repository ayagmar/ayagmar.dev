# 0008. Contracts: zod schemas as the source, JSON Schema generated

Status: accepted, 2026-10-26

## Context

Producers are written in TypeScript (llm-usage-metrics) and Kotlin (trellis); consumers are the site build and its browser island. All of them must agree on shapes without importing each other's code.

## Decision

- `packages/contracts` holds zod 4 schemas: the envelope (`src/envelope.ts`), source ids and stale thresholds (`src/sources.ts`), one file per source under `src/snapshots/` and per producer under `src/push/`, each folder with a barrel `index.ts`, all re-exported from `src/index.ts`.
- Every read API response is `{ source, version: 1, fetchedAt, stale, data }`, built by `envelopeSchema(source, data)`. `fetchedAt` is an RFC 3339 timestamp with offset, or `null`; `data` is `null` until the source has succeeded once.
- `stale` is computed when a response is served by `isStale(lastSuccessAt, thresholdSeconds, now)`: stale when the source never succeeded, when the timestamp is unreadable, or when more than the threshold has passed. Thresholds per source are in `staleAfterSeconds`, a few missed updates of each source's schedule.
- `scripts/export-schema.ts` writes `schema/<name>.input.json` (zod `io: "input"`, for producers) and `schema/<name>.output.json` (for consumers) for every schema listed in `src/json-schemas.ts`. The files are committed; `just contracts-schema` writes them and `just contracts-schema-check` fails when they are stale or orphaned.
- Changes within v1 are additive, at every level of every object. Zod consumers strip unknown fields. For consumers in other languages the export removes `additionalProperties: false` from the output schema, so a plain JSON Schema validator accepts a response that gained a field. That tolerant schema is the consumer path; it was chosen over asking consumers to configure stripping (such as Ajv's `removeAdditional`), which most validators outside JavaScript do not offer. Producers are still held to the exact shape: the Worker builds every response through zod, which drops anything not in the schema, so a tolerant consumer schema never lets a producer's extra field through.
- `corpus/<schema>/{accept,reject}/*.json` is one payload corpus per exported schema. `test/json-schema.test.ts` runs every case through zod, the input schema and the output schema with Ajv (draft 2020-12, formats not asserted because every timestamp also carries a pattern), and requires both kinds of case for every schema in `src/json-schemas.ts`.
- `test/frozen/v1/<name>.output.json` is the consumer schema as v1 first shipped it, never regenerated. The same test checks that current output still validates against it, so a breaking change cannot land in v1 unnoticed. A breaking change ships a `/v2/` path next to v1, keeps the v1 output and its frozen test passing, and freezes a v2 copy.
- Shared fixtures live in `packages/contracts/fixtures/` (layout in its README).

## Consequences

A producer in another language validates against `schema/*.input.json` without running TypeScript. Forgetting to regenerate the schema fails CI.
