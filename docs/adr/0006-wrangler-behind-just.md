# 0006. Wrangler for now, every CLI call behind just

Status: accepted, 2026-10-26

## Context

Cloudflare's new `cf` CLI is in open beta and still delegates dev and deploy of JavaScript Workers to Wrangler. Cloudflare's own agent guidance suggests `cf` for new projects.

## Decision

Use Wrangler 4 (pinned, run from `node_modules`) until `cf` leaves beta. Every Wrangler call is a `just` recipe (`site-*`, `signals-*`, `typegen`, `deployments`, `rollback`), and Workers Builds runs the same recipes, so moving to `cf` is a change to the justfile and `docs/deploy.md` only. The move is tracked in a GitHub issue.

## Consequences

No one runs a global `wrangler` or `npx wrangler`. Commands documented elsewhere point at recipes.
