# 0020. Dependency policy

Status: accepted, 2026-10-26

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

gitleaks for the pre-commit hook is a system tool, not a package (`just tools gitleaks` installs the pinned one into `.tools/bin`).

### CI tools

Release binaries, pinned by version and sha256 in `scripts/bootstrap.sh` (Linux x86_64) and installed into `.tools/bin` by the recipes that need them. The sha256 is the digest GitHub records for the release asset; for gitleaks, osv-scanner, actionlint and lychee it was also checked against the project's own checksum file.

| Tool        | Version  | Why                                                                                         |
| ----------- | -------- | ------------------------------------------------------------------------------------------- |
| gitleaks    | 8.30.1   | Secrets in git history and built output. The binary, not the action, which needs a license. |
| osv-scanner | 2.7.0    | Known vulnerabilities in `pnpm-lock.yaml` when dependencies change.                         |
| lychee      | 0.24.2   | Links in the built site.                                                                    |
| actionlint  | 1.7.12   | Workflow syntax, expressions and the shell in `run:` blocks (with shellcheck).              |
| zizmor      | 1.31.1   | Workflow security audits.                                                                   |
| shellcheck  | 0.11.0   | Shell script lint.                                                                          |
| shfmt       | 3.14.1   | Shell script formatting.                                                                    |
| renovate    | 44.178.3 | `renovate-config-validator` for `renovate.json`, run with `npm exec` (pin in the justfile). |

GitHub Actions, pinned by commit SHA in `.github/`: `actions/checkout` 7.0.1, `actions/setup-node` 7.1.0, `actions/cache` 6.1.0, `actions/upload-artifact` 7.0.2, `actions/download-artifact` 8.0.2, `github/codeql-action` 4.39.1. Nothing else: no third-party action runs in CI.

### Overrides

`pnpm-workspace.yaml` overrides two transitive dependencies osv-scanner flagged, both in the Worker test runtime only: `zod` 4.6.7 under `@cloudflare/vitest-plugin` (GHSA-mrhx-c7xc-m3w5) and `undici` 7.30.1 under `miniflare` (GHSA-4qv8-2p9j-2685, GHSA-f72v-6w45-q472, GHSA-xjj6-f33q-929c). Remove each once its parent depends on a fixed version.

### Renovate

`renovate.json` extends `config:best-practices` (pinned action digests, pinned dev dependencies, the dependency dashboard, weekly lock file maintenance) and sets explicitly:
- `rangeStrategy: pin`, so every update stays an exact version.
- `minimumReleaseAge: 3 days` with `internalChecksFilter: strict` and `minimumReleaseAgeBehaviour: timestamp-required`: no branch is created for a version younger than three days, or one without a release date. pnpm's own `minimumReleaseAge` refuses the same versions at install time; Renovate's default 30-minute buffer covers packages published shortly after their parent.
- Groups: astro and `@astrojs/*`; svelte and svelte-check; cloudflare (wrangler, `@cloudflare/*`, miniflare, workerd); vitest and `@vitest/*`; playwright and `@axe-core/*`; biome; typescript; github-actions; toolchain (Node in `.node-version`, pnpm and just in `mise.toml`).
- Automerge is off by default and on for patch and minor updates only, as pull requests (`automergeType: pr`) merged by GitHub's auto-merge (`platformAutomerge`) with a merge commit (`automergeStrategy: merge-commit`). GitHub merges only once the required `gate` check passes (ADR 0018). Majors, pin and digest updates (a digest swap changes the code that runs without a reviewed version change) and lock file maintenance are normal pull requests with release notes (`fetchChangeLogs: pr`).
- TypeScript is held below 7 (`allowedVersions: <7.0.0`) until `@astrojs/check` and `svelte-check` accept it; the rule says to remove it then.
- A regex manager tracks the tool pins in `scripts/bootstrap.sh` (`# renovate:` comments) and the Renovate pin in the justfile. Renovate cannot update the sha256 next to a bootstrap pin, so those pull requests never automerge and fail CI until someone updates the checksum from the release.

`just renovate-check` validates the config with the pinned Renovate and runs `scripts/renovate-policy.test.ts`, which fails if any rule turns automerge on for anything but patch or minor; CI runs it when tool config changes.

## Consequences

Upgrades arrive as Renovate pull requests after the release-age delay and pass the same checks. TypeScript 7 waits for `astro check` and `svelte-check`.
