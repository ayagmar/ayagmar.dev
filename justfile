# Every local, CI and Workers Builds command goes through here. `just` lists them.

set shell := ["bash", "-euo", "pipefail", "-c"]

# The version of every build: Workers Builds' commit, else the local checkout, else "dev".
commit_sha := env("WORKERS_CI_COMMIT_SHA", `git rev-parse HEAD 2>/dev/null || echo dev`)

# Where the site build reads source data (ADR 0015): the read API when Workers Builds builds
# main, the shared fixtures everywhere else (local, CI, Previews). SIGNALS_MODE overrides it.
signals_mode := env("SIGNALS_MODE", if env("WORKERS_CI_BRANCH", "") == "main" { "api" } else { "fixtures" })
site := "pnpm --filter @min7/site exec"
signals := "pnpm --filter @min7/signals exec"
contracts := "pnpm --filter @min7/contracts exec"

# Typst from scripts/bootstrap.sh (Workers Builds, CI), else the one mise installs.
typst := if path_exists(justfile_directory() / ".tools/bin/typst") == "true" { justfile_directory() / ".tools/bin/typst" } else { "typst" }

[private]
default:
    @just --list

# Install dependencies exactly as locked
install:
    pnpm install --frozen-lockfile

# Use the repo's git hooks (gitleaks on every commit)
hooks:
    git config core.hooksPath .githooks

# Start the site dev server
dev: site-dev

# Build the site and the signals Worker
build: site-build signals-build

# Everything CI checks before merging, except e2e
check: fmt-check lint typecheck knip boundaries contracts-schema-check test

# Format every file Biome covers
fmt:
    pnpm exec biome format --write .
    just --fmt --unstable

# Fail if any file is not formatted
fmt-check:
    pnpm exec biome format .
    just --fmt --check --unstable

# Lint (Biome lint plus import sorting)
lint:
    pnpm exec biome check --formatter-enabled=false --error-on-warnings .

# Generate Worker binding and runtime types from wrangler.jsonc
typegen:
    {{ signals }} wrangler types --strict-vars=false > /dev/null
    {{ site }} wrangler types --strict-vars=false worker/worker-configuration.d.ts > /dev/null

# Type-check every unit, including .astro and .svelte files
typecheck: typegen
    pnpm exec tsc --build packages/contracts apps/signals
    pnpm exec tsc --project tsconfig.json
    {{ site }} tsc --project worker
    {{ site }} astro check --minimumFailingSeverity warning
    {{ site }} svelte-check --fail-on-warnings

# Unit and Worker tests
test:
    {{ contracts }} vitest run
    {{ signals }} vitest run
    {{ site }} vitest run
    node --test scripts/check-boundaries.test.ts scripts/workers-config.test.ts

# Browser tests against the built site served by its real Worker (wrangler dev)
e2e: site-build
    {{ site }} playwright test

# Download the Chromium build Playwright uses (once per Playwright version)
e2e-install:
    {{ site }} playwright install chromium

# Unused files, exports and dependencies
knip:
    pnpm exec knip

# Fail if a unit depends on one it must not (see ARCHITECTURE.md)
boundaries:
    node scripts/check-boundaries.ts

# Start a new draft post: just post "Title of the post"
post title:
    node scripts/new-post.ts {{ quote(title) }}

# Write packages/contracts/schema/*.json from the zod schemas
contracts-schema:
    node packages/contracts/scripts/export-schema.ts

# Fail if packages/contracts/schema/*.json is out of date
contracts-schema-check:
    node packages/contracts/scripts/export-schema.ts --check

# Scan git history and built output for secrets
scan-secrets:
    gitleaks git --redact --no-banner .
    gitleaks dir --redact --no-banner apps/site/dist
    if [ -d apps/signals/dist ]; then gitleaks dir --redact --no-banner apps/signals/dist; fi

# Site: dev server (no search index; run site-build for that)
site-dev:
    {{ site }} astro dev

# Site: static build, search index, headers, and the resume PDF once it is published
site-build: resume
    COMMIT_SHA={{ commit_sha }} SIGNALS_MODE={{ signals_mode }} {{ site }} astro build
    {{ site }} pagefind --site dist --quiet
    {{ site }} node scripts/postbuild.ts
    {{ site }} node scripts/ship-resume.ts

# Resume: write resume/build/resume.pdf from content/about.json
resume:
    TYPST={{ quote(typst) }} {{ site }} node scripts/resume.ts

# Site: serve the built site through its Worker on http://localhost:8790
site-serve:
    {{ site }} wrangler dev --port 8790

# Site: deploy the built site to production
site-deploy:
    {{ site }} wrangler deploy --message "{{ commit_sha }}"

# Site: upload the built site as a Preview (pull requests)
site-preview:
    {{ site }} wrangler preview --message "{{ commit_sha }}"

# Signals: local Worker on http://localhost:8787
signals-dev:
    {{ signals }} wrangler dev --var COMMIT_SHA:{{ commit_sha }}

# Signals: bundle without deploying (checks config and bundling)
signals-build:
    {{ signals }} wrangler deploy --dry-run --outdir dist --var COMMIT_SHA:{{ commit_sha }}

# Signals: deploy to production
signals-deploy:
    {{ signals }} wrangler deploy --var COMMIT_SHA:{{ commit_sha }} --message "{{ commit_sha }}"

# Signals: upload a Preview (pull requests)
signals-preview:
    {{ signals }} wrangler preview --var COMMIT_SHA:{{ commit_sha }} --message "{{ commit_sha }}"

# Signals: set a Worker secret, prompting for its value (deploys a new version)
signals-secret name:
    {{ signals }} wrangler secret put {{ quote(name) }}

# List the 10 most recent deployments of a Worker (site or signals)
deployments worker:
    pnpm --filter @min7/{{ worker }} exec wrangler deployments list

# Roll a Worker (site or signals) back to a version id, or to the previous one when omitted
rollback worker version="":
    pnpm --filter @min7/{{ worker }} exec wrangler rollback {{ version }}
