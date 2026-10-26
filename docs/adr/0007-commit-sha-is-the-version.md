# 0007. No releases: the commit SHA is the version

Status: accepted, 2026-10-26

## Context

Every merge to `main` deploys. Release numbers would add ceremony without telling anyone more than the commit does.

## Decision

- No tags, releases, semver or CHANGELOG for `site` or `signals`. Pull request titles in Conventional Commit form are the history.
- The justfile computes the SHA once: `WORKERS_CI_COMMIT_SHA` in Workers Builds, else `git rev-parse HEAD`, else `dev`. The site build reads it as `COMMIT_SHA` (shown on `/colophon`); signals receives it as the `COMMIT_SHA` var on deploy and preview (returned by `/v1/health`). Deploy messages carry it too.
- Rollback redeploys a previous Cloudflare version (`docs/deploy.md`).
- The only versioned thing is the signals API contract, by path (`/v1/`, ADR 0008).

## Consequences

To know what is live, read `/colophon` or `/v1/health`.
