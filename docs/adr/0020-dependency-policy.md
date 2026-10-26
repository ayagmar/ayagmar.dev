# 0020. Dependency policy

Status: accepted, 2026-10-26. Renovate settings are added with the CI pipeline.

## Context

Every dependency is code that runs at build time, in a Worker or in a browser, and a way in for a compromised release.

## Decision

- Exact versions only: no `^` or `~`. Versions shared by several packages are pinned once in the `catalog:` of `pnpm-workspace.yaml`. `pnpm-lock.yaml` is committed and installs use `--frozen-lockfile`.
- Node comes from `.node-version` (read by mise and Workers Builds); pnpm from `packageManager` (with its sha512) and `mise.toml`; just from `mise.toml` locally and `scripts/bootstrap.sh` (sha256-checked) in Workers Builds.
- `minimumReleaseAge` refuses versions younger than three days. Each pin below is the newest stable version that was at least three days old on 2026-10-26.
- No install scripts run (ADR 0003).
- Prefer platform features to libraries: feeds, the plain-text page, the CSP generator, the boundary check and the schema export use no dependency beyond the ones listed.
- Every dependency has one line here. A pull request that adds one adds its line.

| Package                   | Version | Where                    | Why                                                                                                                    |
| ------------------------- | ------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Node.js                   | 24.22.1 | runtime                  | Current LTS; Astro 7 needs >= 22.23.4.                                                                                 |
| pnpm                      | 12.15.0 | tooling                  | Strict workspace installs, release-age gate (ADR 0003).                                                                |
| just                      | 1.59.0  | tooling                  | The single command runner (ADR 0006).                                                                                  |
| typst                     | 0.15.1  | tooling                  | Compiles the resume PDF from `content/about.json` (ADR 0023). `mise.toml` locally, `scripts/bootstrap.sh` in Builds.   |
| typescript                | 6.0.3   | all                      | Type checking. Held at 6: `astro check` and `svelte-check` do not accept TypeScript 7 yet.                             |
| @types/node               | 24.19.2 | root, contracts, site    | Types for Node scripts and test configs, matching Node 24.                                                             |
| @biomejs/biome            | 2.6.2   | root                     | Format and lint for TS, JS, JSON, CSS, Markdown, YAML, Astro and Svelte. 2.6.3 was under three days old.               |
| knip                      | 6.42.1  | root                     | Unused files, exports and dependencies. 6.43.0 was under three days old.                                               |
| vitest                    | 5.0.5   | contracts, signals, site | Unit tests, and Worker tests through the Cloudflare plugin.                                                            |
| ajv                       | 8.20.0  | contracts (test only)    | Validates the payload corpus against the exported JSON Schema, the way a non-zod consumer would.                       |
| zod                       | 4.6.7   | contracts                | Schemas for every contract; `z.toJSONSchema` exports JSON Schema with no extra package. Same major as Astro's own zod. |
| hono                      | 4.13.13 | signals                  | Routing, JSON responses and error handling for the Worker. 4.13.14 was under three days old.                           |
| wrangler                  | 4.152.0 | signals, site            | Local dev, type generation, bundling, deploy and Previews for both Workers.                                            |
| @cloudflare/vitest-plugin | 1.4.7   | signals                  | Runs Worker tests inside workerd with the real bindings. `@cloudflare/vitest-pool-workers` only supports vitest 4.     |
| astro                     | 7.4.2   | site                     | Static site generator, content collections, sitemap integration host.                                                  |
| @astrojs/svelte           | 9.1.1   | site                     | Svelte islands in Astro.                                                                                               |
| svelte                    | 5.57.2  | site                     | The search island.                                                                                                     |
| @astrojs/sitemap          | 3.7.4   | site                     | `sitemap-index.xml` from the built routes.                                                                             |
| @astrojs/check            | 0.9.12  | site                     | Type-checks `.astro` files (`astro check`).                                                                            |
| svelte-check              | 4.7.7   | site                     | Type-checks `.svelte` files.                                                                                           |
| pagefind                  | 1.5.2   | site                     | Static search index built after `astro build`; the search island uses its browser bundle.                              |
| @playwright/test          | 1.64.1  | site                     | Browser tests against `wrangler dev` (Chromium only).                                                                  |
| @axe-core/playwright      | 4.14.0  | site                     | Accessibility checks (WCAG 2.2 AA) inside Playwright.                                                                  |

gitleaks for the pre-commit hook is a system tool, not a package; CI pins its own copy.

## Consequences

Upgrades arrive as Renovate pull requests after the release-age delay and pass the same checks. TypeScript 7 waits for `astro check` and `svelte-check`.
