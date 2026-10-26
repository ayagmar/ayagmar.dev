# Every local, CI and Workers Builds command goes through here. `just` lists them.

set shell := ["bash", "-euo", "pipefail", "-c"]

# The version of every build: Workers Builds' commit, else the local checkout, else "dev".
# renovate: datasource=npm depName=renovate
renovate_version := "44.178.3"
commit_sha := env("WORKERS_CI_COMMIT_SHA", `git rev-parse HEAD 2>/dev/null || echo dev`)
site := "pnpm --filter @min7/site exec"
signals := "pnpm --filter @min7/signals exec"
contracts := "pnpm --filter @min7/contracts exec"

# Pinned tools from scripts/bootstrap.sh come first, so local runs match CI.
export PATH := justfile_directory() / ".tools/bin" + ":" + env("PATH")

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
test: test-contracts test-signals test-site test-scripts

# Contracts: zod and JSON Schema agree on the corpus, frozen v1 consumers still parse
test-contracts:
    {{ contracts }} vitest run

# Signals: Worker tests in workerd
test-signals:
    {{ signals }} vitest run

# Site: unit tests (feeds, headers, frontmatter schema, postbuild)
test-site:
    {{ site }} vitest run

# Repo scripts: boundaries, Wrangler configs, CI plan and gate, secret scanner
test-scripts:
    node --test scripts/*.test.ts

# Browser tests against the built site served by its real Worker (wrangler dev)
e2e: site-build e2e-test

# Browser tests against an existing apps/site/dist (CI downloads it from the build job)
e2e-test:
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

# Scan the git history for secrets (gitleaks; prints file, line and rule only)
scan-secrets-source: (tools "gitleaks")
    node scripts/gitleaks-report.ts git .

# Scan the built site and signals bundle for secrets; run site-build and signals-build first
scan-secrets: scan-site scan-signals

# Scan apps/site/dist for secrets
scan-site: (scan-artifact "apps/site/dist")

# Scan the signals bundle (apps/signals/dist) for secrets
scan-signals: (scan-artifact "apps/signals/dist")

# Scan a directory of built output for secrets with both scanners; either one fails it
scan-artifact dir: (tools "gitleaks")
    ok=true; node scripts/scan-secrets.ts {{ quote(dir) }} || ok=false; node scripts/gitleaks-report.ts dir {{ quote(dir) }} || ok=false; "${ok}"

# Site: fail if the built site has no search index (run after site-build)
site-dist-check:
    node -e 'const e = require("./apps/site/dist/pagefind/pagefind-entry.json"); const n = Object.values(e.languages).reduce((s, l) => s + l.page_count, 0); if (n === 0) throw new Error("pagefind indexed no pages"); console.log(`pagefind: ${n} pages indexed`)'

# Links in the built site: internal ones offline first, then external ones (lychee.toml)
links: links-internal
    lychee --config lychee.toml --root-dir "{{ justfile_directory() }}/apps/site/dist" --remap '^https://ayagmar\.dev/?(.*)$ file://{{ justfile_directory() }}/apps/site/dist/$1' apps/site/dist

# Links in the built site that stay on ayagmar.dev, without network
links-internal: (tools "lychee")
    lychee --config lychee.toml --offline --root-dir "{{ justfile_directory() }}/apps/site/dist" --remap '^https://ayagmar\.dev/?(.*)$ file://{{ justfile_directory() }}/apps/site/dist/$1' apps/site/dist

# Site: dev server (no search index; run site-build for that)
site-dev:
    {{ site }} astro dev

# Site: static build, search index, headers
site-build:
    COMMIT_SHA={{ commit_sha }} {{ site }} astro build
    {{ site }} pagefind --site dist --quiet
    {{ site }} node scripts/postbuild.ts

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

# List the 10 most recent deployments of a Worker (site or signals)
deployments worker:
    pnpm --filter @min7/{{ worker }} exec wrangler deployments list

# Roll a Worker (site or signals) back to a version id, or to the previous one when omitted
rollback worker version="":
    pnpm --filter @min7/{{ worker }} exec wrangler rollback {{ version }}

# Install pinned CI tools into .tools/bin (sha256-checked): just tools gitleaks lychee
tools *names:
    ./scripts/bootstrap.sh {{ names }}

# CI: which jobs this change needs (see scripts/ci.ts)
ci-plan:
    node scripts/ci.ts plan

# CI: pass only if every planned job succeeded ($NEEDS is the needs context)
ci-gate:
    node scripts/ci.ts gate

# CI: the plan and gate decisions for known changes, and ci.yml matching them
ci-test:
    node --test scripts/ci-*.test.ts

# CI: no Wrangler call or Cloudflare credential in GitHub Actions
ci-policy:
    node scripts/ci-policy.ts

# Lint GitHub workflows and actions (actionlint with shellcheck, zizmor)
workflows-lint: (tools "actionlint" "shellcheck" "zizmor")
    actionlint
    zizmor --no-progress .

# Lint and format-check shell scripts
shell-lint: (tools "shellcheck" "shfmt")
    git ls-files -z '*.sh' .githooks | xargs -0 shellcheck
    git ls-files -z '*.sh' .githooks | xargs -0 shfmt --diff --indent 2 --case-indent

# Known vulnerabilities in locked dependencies (osv-scanner)
osv: (tools "osv-scanner")
    osv-scanner scan source --lockfile pnpm-lock.yaml

# Validate renovate.json with the pinned Renovate, and its automerge policy
renovate-check:
    node --test scripts/renovate-policy.test.ts
    npm exec --yes --package renovate@{{ renovate_version }} -- renovate-config-validator --strict --no-global renovate.json

# Apply the main branch ruleset and merge settings on GitHub (owner, needs gh with admin)
repo-ruleset:
    ./scripts/repo-ruleset.sh
