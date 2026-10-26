# 0016. Mocking: one fixture set, MSW at the network boundary

Status: accepted, 2026-10-26

## Context

The same upstream answers are needed by the normalizer tests, the Worker tests, the contract tests and the site's offline `fixtures` mode. Copies drift. Tests must never reach a real upstream, and the Worker tests run inside workerd, where Node's MSW interceptors do not apply.

## Decision

- One fixture set in `packages/contracts/fixtures/` (layout and cases in its README): raw upstream answers per upstream (`lastfm`, `repo-pulse`, `github`, `npm`) in the shape the adapters' `fetch` returns, and normalized snapshots per source (`listening`, `shipping`, `projects`). The Last.fm and GitHub `ok` cases are real public data from 2026-10-26, seeded from the prototypes' `site.json`; the repo-pulse cases are marked sample data.
- `src/fixtures.ts` imports every fixture statically (workerd has no file system) and is exported as `@min7/contracts/fixtures`. `test/fixtures.test.ts` fails when a file on disk is not registered there.
- `src/testing.ts`, exported as `@min7/contracts/testing` and never from the package root, builds MSW handlers from the raw fixtures: `upstreamHandlers({ lastfm, github, npm, repoPulse })` answers Last.fm, GitHub, npm and repo-pulse with one case each, a `null` answer as a network error. `fixtureEnvelope(source, fetchedAt)` wraps an `ok` snapshot as the read API would.
- Worker tests (`apps/signals/test/pull-fetch.test.ts`) use `@msw/cloudflare` `setupNetwork()`, configured with `onUnhandledFrame: 'error'`, so a request no handler answers fails the fetch. A test proves a request to an unexpected host fails.
- Node tests (`apps/site/test/reader.test.ts`) use `msw/node` `setupServer`, also with `onUnhandledFrame: 'error'`. The one case MSW's Node interceptor cannot simulate, a body that stalls after the headers, uses a real local `node:http` server.
- Normalizer tests run every raw case through its normalizer: a case with a snapshot fixture must produce exactly that snapshot, one without must throw the listed `PullError` code. The contract test (`packages/contracts/test/json-schema.test.ts`) reads the snapshot fixtures and the repo-pulse raw bodies in place as corpus cases, so they are checked by zod and by Ajv against the exported JSON Schema.
- e2e tests run on the fixtures build. Playwright's own routing stands in for the read API when testing the parts of pages the browser keeps current (ADR 0015).

## Consequences

A new upstream case is one JSON file plus one line in `src/fixtures.ts`, and every layer uses it. msw stays a dev dependency; the site and Worker bundles never import `@min7/contracts/testing`.
