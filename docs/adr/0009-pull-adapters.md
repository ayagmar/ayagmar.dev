# 0009. Pull adapters

Status: accepted, 2026-10-26

## Context

signals pulls three sources on a cron: Last.fm (listening), the repo-pulse public feed (shipping) and GitHub plus npm (projects). Each upstream fails in its own ways, the Worker runs on the Free plan (10 ms of CPU per cron invocation, 50 subrequests), and no upstream text may reach a log, a response or the site.

## Decision

- One file per adapter in `apps/signals/src/adapters/pull/`, each a `PullAdapter` (`src/adapters/types.ts`): `fetch(env, signal)` does the I/O and returns the raw answers; `normalize(raw)` is pure and returns the snapshot. `pullAdapters` in `index.ts` lists them for the cron runner.
- `fetch` reads every upstream through `getJson` (`http.ts`): one GET with the caller's signal plus its own 5 s timeout, a body cap checked against `Content-Length` and again while streaming (128 KiB for Last.fm, 256 KiB for GitHub and repo-pulse), and the body parsed as JSON or kept as null. It returns `{ status, body }` for any HTTP status, so `normalize` sees 404s and error bodies as data. The raw fixtures record exactly this shape.
- A snapshot built from several requests degrades per part. A part that fails on its own (Last.fm top artists or a weekly count, a project's release or npm downloads, one repository's metadata) becomes `null` in the snapshot. The part a snapshot cannot exist without (Last.fm recent tracks, the repo-pulse feed, GitHub metadata for every featured repository at once) throws.
- Failures throw `PullError` with a `code` from a closed list (`not_configured`, `upstream_unreachable`, `upstream_timeout`, `upstream_too_large`, `upstream_not_found`, `upstream_rate_limited`, `upstream_http_error`, `upstream_error`, `upstream_malformed`). Its message is the code and it carries no `cause`, so logging the error cannot leak a URL with the Last.fm key, a token or an upstream body. The cron runner records `error.code`.
- Wire schemas live next to the output schemas in `packages/contracts/src/snapshots/` and declare only the fields the normalizer reads; zod drops the rest. Every normalizer ends by parsing its result with the output schema, which is the allowlist: a field not in the contract cannot be served.
- Timestamps are stored absolute, RFC 3339 in UTC (`2026-10-26T08:53:00Z`). Last.fm's `"26 Oct 2026, 08:53"` and anything like "7 minutes ago" are never stored; the site renders relative times.

Per source:
- **listening** (every 60 s): four Last.fm calls for user `min7_` with `LASTFM_API_KEY`: `user.getrecenttracks` (10 items), `user.gettopartists` (overall, 10), and `user.getrecenttracks` with `limit=1` and `from`/`to` for this week and last week, reading only `@attr.total`. Weeks start Monday 00:00 UTC. Now playing is the first track with `@attr.nowplaying === "true"` and is not repeated in `recent`. Last.fm quirks handled: a list of one is a bare object, an empty list is `[]`, errors come as `{ error, message }` even with HTTP 200 (error 6 is an unknown user, 29 the rate limit), images are never read (the site loads nothing from Last.fm), links are kept only when they point to `https://www.last.fm/`.
- **shipping** (every 15 min): `GET https://repo-pulse.ayagmar.workers.dev/public/feed?limit=50` (contract in ADR 0012). Until repo-pulse serves it, the 404 throws `upstream_not_found`, the source never succeeds and the site shows its empty state. Events are checked one by one, so an event of a type this adapter does not know is skipped. Stars on one repository on one UTC day become one entry with the number gained and the latest total.
- **projects** (daily): for each entry of `featuredProjects` (`packages/contracts/src/projects.ts`), `GET /repos/{repo}` and `/repos/{repo}/releases/latest` on api.github.com, and `GET https://api.npmjs.org/downloads/point/last-month/{package}` when the entry names a package. `GITHUB_TOKEN` is optional (a token with no scopes; public data only) and is sent to api.github.com only. A 404 or a private repository drops the project; a renamed repository answers with its new name and URL, which the snapshot shows under the same slug; a release 404 means no release. Without a token GitHub allows 60 requests an hour per IP, and Cloudflare's egress IPs are shared, so the daily pull may be refused (`upstream_rate_limited`) until a token is set.
- The featured list is in `contracts`, not in signals, because the site joins posts to projects by `slug`. Every project in the snapshot carries its slug.

Bounds: at most 4 + 3 × 8 + 1 = 29 subrequests across the three adapters, each body capped, and lists capped at 10 tracks, 10 artists and 50 events, so parsing stays far below the CPU limit.

## Consequences

Adding a source is one adapter file, its schemas in `contracts` and its fixtures. The cron runner (signals intake PR) does not know any upstream: it calls `fetch`, then `normalize`, and records either the snapshot or `PullError.code`. Secrets are not declared in `wrangler.jsonc`, so the generated `Env` does not list them; `readSecret` reads them and treats empty as unset.
