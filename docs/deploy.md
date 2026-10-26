# Deploying

Both Workers deploy through [Cloudflare Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/): Cloudflare clones the repo, builds, and deploys `main` to production. Every other branch gets a [Preview](https://developers.cloudflare.com/workers/previews/) with a public URL. GitHub Actions never deploys and holds no Cloudflare token.

Workers Builds has Node and pnpm but not `just`. `scripts/bootstrap.sh` downloads the pinned `just` from its GitHub release into `.tools/bin`, checks its sha256, and every command then goes through a `just` recipe, the same ones used locally.

## One-time setup

Do this once per Worker in the Cloudflare dashboard: **Workers & Pages → Create → Import a repository**, pick `ayagmar/ayagmar.dev`, then fill in the settings below. The Worker name must match `name` in the Worker's `wrangler.jsonc`.

Both projects:
- **Root directory:** the repository root (leave empty or `/`).
- **Node.js:** read from `.node-version`. Do not set `NODE_VERSION`.
- **pnpm:** read from `packageManager` in `package.json`. Do not set `PNPM_VERSION`.
- **Dependencies:** installed by Workers Builds from `pnpm-lock.yaml`. Leave `SKIP_DEPENDENCY_INSTALL` unset.
- **Build variables:** none. The commit SHA comes from `WORKERS_CI_COMMIT_SHA`, which Workers Builds sets. The site build reads the signals API when `WORKERS_CI_BRANCH` is `main` and the shared fixtures for every other branch (ADR 0015).

### Site (`min7-site`, ayagmar.dev)

| Setting                              | Value                                                                                                                                                                       |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build command                        | `./scripts/bootstrap.sh && .tools/bin/just site-build`                                                                                                                      |
| Deploy command                       | `.tools/bin/just site-deploy`                                                                                                                                               |
| Non-production branch deploy command | `.tools/bin/just site-preview`                                                                                                                                              |
| Build watch paths, include           | `apps/site/*`, `packages/contracts/*`, `content/*`, `scripts/*`, `justfile`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.node-version` |
| Build watch paths, exclude           | none                                                                                                                                                                        |

### Signals (`min7-signals`, api.ayagmar.dev)

| Setting                              | Value                                                                                                                                                                        |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build command                        | `./scripts/bootstrap.sh && .tools/bin/just signals-build`                                                                                                                    |
| Deploy command                       | `.tools/bin/just signals-deploy`                                                                                                                                             |
| Non-production branch deploy command | `.tools/bin/just signals-preview`                                                                                                                                            |
| Build watch paths, include           | `apps/signals/*`, `packages/contracts/*`, `scripts/bootstrap.sh`, `justfile`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.node-version` |
| Build watch paths, exclude           | none                                                                                                                                                                         |

Custom domains: each `wrangler.jsonc` declares its domain as a `custom_domain` route, which `wrangler deploy` creates. The `ayagmar.dev` zone must be on the same Cloudflare account. If the deploy cannot create it, add it under the Worker's **Settings → Domains & Routes** instead.

## Secrets (signals)

Set once, from a checkout with Wrangler logged in; each command prompts for the value and deploys a new version:

```sh
just signals-secret LASTFM_API_KEY   # from https://www.last.fm/api/account/create
just signals-secret GITHUB_TOKEN     # optional: a fine-grained token with no permissions (public data)
```

Without `LASTFM_API_KEY` the listening pull fails with `not_configured`. Without `GITHUB_TOKEN` GitHub allows 60 requests an hour per IP, shared with other Workers, so the daily projects pull may be refused.

## D1 (signals)

`apps/signals/wrangler.jsonc` declares the `DB` binding with placeholder ids. Before the first signals deploy:

```sh
cd apps/signals
pnpm exec wrangler d1 create min7-signals
pnpm exec wrangler d1 create min7-signals-preview
```

Put the first id in `d1_databases` and the second in `previews.d1_databases` of `wrangler.jsonc` and in `wrangler.preview-migrations.jsonc`, then commit. Every Preview shares `min7-signals-preview`; no Preview ever binds the production database. Migration recipes arrive with the first migration.

Migrations only add (expand) or remove what no deployed version still reads (contract), so the previous Worker version always runs against the current schema.

## Previews

- Preview URLs are public. Nothing secret is served, so they stay unprotected.
- Previews get their own `vars` and D1 binding from the `previews` block; they never inherit production bindings.
- Cron triggers never run for Previews.
- Secrets for Previews are set with `wrangler preview secret put` or the Preview base config, never copied from production.

## Rollback

The commit SHA is the version: it is in the colophon (`/colophon`) and in `GET https://api.ayagmar.dev/v1/health`.

To roll back one Worker without touching the other:
1. Find the version: `just deployments site` (or `signals`), or the Worker's **Deployments** tab in the dashboard. Each version's message is the commit SHA.
2. Roll back: `just rollback site <version-id>`, or **Rollback** next to that version in the dashboard. Without an id, `just rollback site` goes to the previous version.
3. Revert the commit on `main` so the next deploy does not bring the problem back.

A rollback restores a Worker version: its code, config and, for the site, its static assets. Connected resources are not rolled back: D1 keeps its current data and schema. Because migrations are expand/contract, the older signals version still reads the current schema. See [rollback limitations](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/).
