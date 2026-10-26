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

## D1 (signals)

`apps/signals/wrangler.jsonc` declares the `DB` binding with placeholder ids. Before the first signals deploy:

```sh
just signals-db-create
```

Put the first id in `d1_databases` and the second in `previews.d1_databases` of `wrangler.jsonc` and in `wrangler.preview-migrations.jsonc`, then commit. Every Preview shares `min7-signals-preview`; no Preview ever binds the production database (`scripts/workers-config.test.ts` checks this).

| Recipe                         | Applies `apps/signals/migrations/` to                           |
| ------------------------------ | --------------------------------------------------------------- |
| `just signals-migrate-local`   | the local database `just signals-dev` uses                      |
| `just signals-migrate-remote`  | `min7-signals` (production), via `wrangler.jsonc`               |
| `just signals-migrate-preview` | `min7-signals-preview`, via `wrangler.preview-migrations.jsonc` |

`just signals-deploy` runs `signals-migrate-remote` first and `just signals-preview` runs `signals-migrate-preview` first, so Workers Builds applies migrations before it uploads code. Migrations only add (expand) or remove what no deployed version still reads (contract), so the previous Worker version always runs against the current schema.

**Workers Builds token.** The API token Workers Builds creates by default has no D1 permission. In the signals project's **Settings → Build → API token**, edit the token (or create one) to add **Account → D1 → Edit**. Without it, the deploy and preview commands fail at the migration step.

## Secrets (signals)

`LASTFM_API_KEY` (from https://www.last.fm/api/account/create) and the six push secrets are required; the push secrets and their rotation are in [docs/operations.md](operations.md). `GITHUB_TOKEN` is optional: a fine-grained token with no permissions (public data). Once, before the first signals deploy:

```sh
just signals-secrets                 # production: prompts for each required value
just signals-secret GITHUB_TOKEN     # production, optional
just signals-preview-secrets         # Preview base config: random fake values
```

`secrets.required` in `wrangler.jsonc` makes a production deploy fail while a required secret is missing; `GITHUB_TOKEN` is not in that list. Without it GitHub allows 60 requests an hour per IP, shared with other Workers, so the daily projects pull may be refused. Locally, without `LASTFM_API_KEY` in `.dev.vars`, the listening pull fails with `not_configured`.

Wrangler rejects `secrets` under `previews`, so Previews are not checked the same way; a Preview without its base config secrets answers every push with 401. The fake `LASTFM_API_KEY` in Previews is never used, because the cron never runs there.

## Resolved bindings (signals)

Read from the configs with Wrangler 4.152's `unstable_readConfig` and `wrangler deploy --dry-run` on 2026-10-26:

| Binding / target      | Production (`wrangler deploy`)     | Previews (`wrangler preview`)                                |
| --------------------- | ---------------------------------- | ------------------------------------------------------------ |
| `DB`                  | `min7-signals`                     | `min7-signals-preview`                                       |
| Migrations applied to | `min7-signals` (`wrangler.jsonc`)  | `min7-signals-preview` (`wrangler.preview-migrations.jsonc`) |
| `PUSH_RATE_LIMIT`     | namespace `1001`, 10 per 60 s      | namespace `1002`, 10 per 60 s                                |
| `COMMIT_SHA`          | commit SHA (`--var`)               | commit SHA (`--var`); `preview` without it                   |
| Required secrets      | Worker secrets, required on deploy | Preview base config, random fakes                            |
| Cron `* * * * *`      | runs                               | never runs                                                   |

## Previews

- Preview URLs are public. Nothing secret is served, so they stay unprotected.
- Previews get their own `vars` and D1 binding from the `previews` block; they never inherit production bindings.
- Cron triggers never run for Previews.
- Secrets for Previews live in the Preview base config (`just signals-preview-secrets`, which runs `wrangler preview base-config secret put`), never copied from production. Base config secrets reach Previews created after they are set.

## Rollback

The commit SHA is the version: it is in the colophon (`/colophon`) and in `GET https://api.ayagmar.dev/v1/health`.

To roll back one Worker without touching the other:
1. Find the version: `just deployments site` (or `signals`), or the Worker's **Deployments** tab in the dashboard. Each version's message is the commit SHA.
2. Roll back: `just rollback site <version-id>`, or **Rollback** next to that version in the dashboard. Without an id, `just rollback site` goes to the previous version.
3. Revert the commit on `main` so the next deploy does not bring the problem back.

A rollback restores a Worker version: its code, config and, for the site, its static assets. Connected resources are not rolled back: D1 keeps its current data and schema. Because migrations are expand/contract, the older signals version still reads the current schema. See [rollback limitations](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/).
