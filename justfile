# Every local, CI and Workers Builds command goes through here. `just` lists them.

set shell := ["bash", "-euo", "pipefail", "-c"]

# The version of every build: Workers Builds' commit, else the local checkout, else "dev".
# renovate: datasource=npm depName=renovate
renovate_version := "44.181.6"
commit_sha := env("WORKERS_CI_COMMIT_SHA", `git rev-parse HEAD 2>/dev/null || echo dev`)

# Where the site build reads source data (ADR 0015): the read API when Workers Builds builds
# main, the shared fixtures everywhere else (local, CI, Previews). SIGNALS_MODE overrides it.
signals_mode := env("SIGNALS_MODE", if env("WORKERS_CI_BRANCH", "") == "main" { "api" } else { "fixtures" })
site := "pnpm --filter @min7/site exec"
signals := "pnpm --filter @min7/signals exec"
contracts := "pnpm --filter @min7/contracts exec"
# Every required signals secret, matching secrets.required in apps/signals/wrangler.jsonc.
# GITHUB_TOKEN and MONKEYTYPE_APE_KEY are optional and set on their own: `just signals-secret <name>`.
required_secrets := "LASTFM_API_KEY PUSH_TOKEN_LLM_USAGE PUSH_TOKEN_LLM_USAGE_NEXT PUSH_TOKEN_TRELLIS PUSH_TOKEN_TRELLIS_NEXT PUSH_HMAC_TRELLIS PUSH_HMAC_TRELLIS_NEXT PUSH_TOKEN_DESKTOP PUSH_TOKEN_DESKTOP_NEXT"

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
test: test-contracts test-signals test-site test-scripts test-producers

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

# Producers on the owner's machine: delivery, desktop facts, llm-usage mapping (ADR 0014, 0032)
test-producers:
    node --test producers/*.test.ts

# Producers: print both push bodies built from sample readings dated now. Reads no host
# state, credentials or session logs, and sends nothing.
producers-dry-run:
    dir="$(mktemp -d)"; trap 'rm -rf "$dir"' EXIT; node producers/samples.ts "$dir"; node producers/desktop.ts --dry-run --fixtures "$dir/desktop"; node producers/llm-usage.ts --dry-run --fixtures "$dir/llm-usage"

# Producers: push sample bodies to the local Worker (just signals-dev) with the fake tokens in
# apps/signals/.dev.vars, from a temporary state directory
producers-local origin="http://127.0.0.1:8787":
    dir="$(mktemp -d)"; trap 'rm -rf "$dir"' EXIT; node producers/samples.ts "$dir"; for producer in desktop llm-usage; do name="PUSH_TOKEN_$(echo "$producer" | tr a-z- A-Z_)"; MIN7_TEST_ENDPOINT={{ quote(origin) }} MIN7_STATE_DIR="$dir/state-$producer" MIN7_TEST_TOKEN="$(sed -n "s/^$name=//p" apps/signals/.dev.vars)" node "producers/$producer.ts" --fixtures "$dir/$producer"; done

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

# Links in the built site: internal ones offline first, then external ones (lychee.toml),
# except the sample links the fixtures-mode build renders (scripts/fixture-urls.ts)
links: links-internal
    lychee --config lychee.toml --exclude "$(node scripts/fixture-urls.ts)" --root-dir "{{ justfile_directory() }}/apps/site/dist" --remap '^https://ayagmar\.dev/?(.*)$ file://{{ justfile_directory() }}/apps/site/dist/$1' apps/site/dist

# Links in the built site that stay on ayagmar.dev, without network
links-internal: (tools "lychee")
    lychee --config lychee.toml --offline --root-dir "{{ justfile_directory() }}/apps/site/dist" --remap '^https://ayagmar\.dev/?(.*)$ file://{{ justfile_directory() }}/apps/site/dist/$1' apps/site/dist

# Site: fail if a page in apps/site/dist is over its static budget (run after site-build)
budgets:
    node scripts/budgets.ts

# Site: Lighthouse on apps/site/dist through its Worker, both profiles (`--profile desktop` for
# one) and `--base <dir>` to compare with another build's apps/site. Needs e2e-install once.
lighthouse *args:
    CHROME_PATH="$({{ site }} node -p 'require("@playwright/test").chromium.executablePath()')" node scripts/lighthouse.ts {{ args }}

# CI: Lighthouse for the profile in $LIGHTHOUSE_PROFILE on the site artifact against the base
# build in .lighthouse/base, with the base's numbers cached in .lighthouse/cache (ci.yml)
lighthouse-ci: (lighthouse "--base" ".lighthouse/base/apps/site" "--profile" env("LIGHTHOUSE_PROFILE") "--out" (".lighthouse/metrics-" + env("LIGHTHOUSE_PROFILE") + ".json") "--base-cache" ".lighthouse/cache/base.json" "--head-cache" ".lighthouse/cache/head.json")

# CI: copy scripts/lighthouse-report.js into the lighthouse-comment job (run after editing it)
lighthouse-embed:
    node scripts/lighthouse-embed.ts

# Skills: rewrite content/skills.json from the public skills repo's main branch; pass
# `--evals ~/projects/agents-skills/eval-results` (the repo does not track them) or `--from <checkout>`
skills-sync *args:
    node scripts/skills-sync.ts {{ args }}

# Site: dev server (no search index; run site-build for that)
site-dev:
    {{ site }} astro dev

# Site: static build, search index, headers
site-build:
    COMMIT_SHA={{ commit_sha }} SIGNALS_MODE={{ signals_mode }} {{ site }} astro build
    {{ site }} pagefind --site dist --quiet
    {{ site }} node scripts/postbuild.ts

# Site: the same build with drafts shown, in apps/site/node_modules/.cache/preview, for the e2e
# checks of TIL notes while every note is a draft (ADR 0028)
site-build-preview:
    PUBLIC_SHOW_DRAFTS=1 COMMIT_SHA={{ commit_sha }} SIGNALS_MODE=fixtures {{ site }} astro build --outDir node_modules/.cache/preview
    {{ site }} pagefind --site node_modules/.cache/preview --quiet
    {{ site }} node scripts/postbuild.ts node_modules/.cache/preview

# Site: rebuild the subset WOFF2 fonts in apps/site/src/fonts from the upstream releases (ADR 0026)
fonts:
    cd apps/site && uv run --no-project --with fonttools==4.67.0 --with brotli==1.2.1 python scripts/fonts.py

# Site: redraw the home page room, apps/site/src/assets/room-{night,day}.png (ADR 0026)
scene:
    cd apps/site && uv run --no-project --with pillow==13.0.0 python scripts/scene.py

# Site: serve the built site through its Worker on http://localhost:8790
site-serve:
    {{ site }} wrangler dev --port 8790

# Site: deploy the built site to production
site-deploy:
    {{ site }} wrangler deploy --message "{{ commit_sha }}"

# Site: upload the built site as a Preview (pull requests)
site-preview:
    {{ site }} wrangler preview --message "{{ commit_sha }}"

# Signals: local Worker on http://localhost:8787 (run signals-migrate-local first)
signals-dev:
    {{ signals }} wrangler dev --var COMMIT_SHA:{{ commit_sha }}

# Signals: CPU per cron invocation of each pull adapter, in a local workerd (ADR 0030; Linux only)
signals-cpu *scenarios:
    nice -n 10 node scripts/signals-cpu.ts {{ scenarios }}

# Signals: bundle without deploying (checks config and bundling)
signals-build:
    {{ signals }} wrangler deploy --dry-run --outdir dist --var COMMIT_SHA:{{ commit_sha }}

# Signals: apply pending migrations to the production database, then deploy to production
signals-deploy: signals-migrate-remote
    {{ signals }} wrangler deploy --var COMMIT_SHA:{{ commit_sha }} --message "{{ commit_sha }}"

# Signals: apply pending migrations to the shared preview database, then upload a Preview
signals-preview: signals-migrate-preview
    {{ signals }} wrangler preview --var COMMIT_SHA:{{ commit_sha }} --message "{{ commit_sha }}"

# Signals: create the production and preview D1 databases (once; put the ids in the configs)
signals-db-create:
    {{ signals }} wrangler d1 create min7-signals
    {{ signals }} wrangler d1 create min7-signals-preview

# Signals: apply pending migrations to the local database that signals-dev uses
signals-migrate-local:
    {{ signals }} wrangler d1 migrations apply DB --local

# Signals: apply pending migrations to the production database (min7-signals)
signals-migrate-remote:
    {{ signals }} wrangler d1 migrations apply DB --remote

# Signals: apply pending migrations to the shared preview database (min7-signals-preview)
signals-migrate-preview:
    {{ signals }} wrangler d1 migrations apply DB --remote --config wrangler.preview-migrations.jsonc

# Signals: set one production secret; Wrangler prompts for the value (deploys a new version)
signals-secret name:
    {{ signals }} wrangler secret put {{ quote(name) }}

# Signals: set each required production secret in turn
signals-secrets:
    for name in {{ required_secrets }}; do just signals-secret "$name"; done

# Signals: give the Preview base config a random fake value for one secret, shown to no one
signals-preview-secret name:
    openssl rand -hex 32 | {{ signals }} wrangler preview base-config secret put {{ quote(name) }}

# Signals: give the Preview base config random fake required secrets, shown to no one
signals-preview-secrets:
    for name in {{ required_secrets }}; do just signals-preview-secret "$name"; done

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
