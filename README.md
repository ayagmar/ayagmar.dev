# ayagmar.dev

Source of [ayagmar.dev](https://ayagmar.dev) (min7), the personal site and writing of Abdeslam Yassine Agmar.

The repo holds three units:
- `apps/site`: the Astro site (static pages, feeds, search) and the small Worker that serves it.
- `apps/signals`: a Cloudflare Worker on `api.ayagmar.dev` that will collect listening, project and usage data and serve it as JSON.
- `packages/contracts`: the zod schemas both sides agree on, exported as JSON Schema for producers in other languages.

[ARCHITECTURE.md](ARCHITECTURE.md) explains how they fit together and [docs/adr/](docs/adr/) records why.

Code is MIT. Writing under `content/` is all rights reserved ([content/LICENSE](content/LICENSE)).

## Run it

You need [mise](https://mise.jdx.dev). It reads Node from `.node-version` and pins pnpm and just in `mise.toml`.

```sh
mise install
just install        # pnpm install --frozen-lockfile
just hooks          # gitleaks on every commit (needs gitleaks installed)
just e2e-install    # Chromium for Playwright, once
```

Then:

```sh
just dev            # Astro dev server; search needs a build
just site-build     # dist/ with the search index and _headers
just site-serve     # the built site through its Worker, http://localhost:8790
just signals-migrate-local   # once, and after a new migration
just signals-dev    # the signals Worker, http://localhost:8787/v1/health
```

`just` with no arguments lists every recipe. Checks before a PR:

```sh
just check          # format, lint, types, knip, boundaries, schema, unit tests
just e2e            # builds, then Playwright + axe against wrangler dev
just budgets        # after a build: JS, weight, fonts, origins, image sizes per page
just lighthouse --profile desktop   # after a build: Lighthouse per page (ADR 0017)
```

## Write a post

```sh
just post "Title of the post"
```

This creates `content/writing/title-of-the-post.md` with `draft: true`. Write it, set `draft: false` when it is ready, and open a pull request. [CONTRIBUTING.md](CONTRIBUTING.md) has the full flow and the frontmatter fields.

## Edit the about page

`content/about.json` holds the facts for the about page: identity, summary, the note on the name (`nameNote`, a quiet line under the summary), experience (newest first), certifications, education, skills. Months are written `YYYY-MM`; `"end": null` marks the current role. A wrong or misspelled field fails the build with a message naming it.

## Deploy

Cloudflare Workers Builds deploys both Workers from `main` and builds a preview for each pull request. No Cloudflare token lives in GitHub. Setup and rollback are in [docs/deploy.md](docs/deploy.md); what search engines read and the analytics, in [docs/seo.md](docs/seo.md).
