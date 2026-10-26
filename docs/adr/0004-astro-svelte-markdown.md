# 0004. Astro 7 static output, Svelte 5 islands, Markdown content

Status: accepted, 2026-10-26

## Context

The site is mostly text. Pages must ship no JavaScript unless a feature needs it, and posts must be easy to write and review in a pull request.

## Decision

- Astro 7 with `output: 'static'`. Svelte 5 for islands only; the search dialog is the only island so far.
- Posts are Markdown files in the root `content/writing/`, read by a content collection with the `glob` loader. Root `content/` keeps content-only pull requests path-filterable. No MDX until a post needs a component.
- The frontmatter schema (`apps/site/src/lib/writing-schema.ts`) is strict: unknown fields, empty titles, bad dates, non-slug tags and an `updated` before `date` fail the build with the file and field named.
- Known gap in date validation: Astro parses frontmatter with the `yaml` package's `timestamp` tag (`@astrojs/internal-helpers`) before the schema runs, and that tag rolls an impossible unquoted date over, so `date: 2026-02-30` reaches the schema as 2026-03-02 and passes. The schema cannot tell it from a real date, and catching it would need a custom loader that rereads the raw file, which is not worth it for a typo the post list makes visible. Quoted dates (`date: '2026-02-30'`) are checked as calendar days and fail.
- Drafts are excluded unless the build sets `PUBLIC_SHOW_DRAFTS=1`.
- `build.format: 'file'` and `trailingSlash: 'never'`: `/writing` is `writing.html`, so Workers static assets serve every page without a trailing-slash redirect, and canonical URLs, the sitemap and feed links share one form.
- `build.inlineStylesheets: 'never'`, so styles stay in files the CSP allows by origin (ADR 0019).
- Markdown syntax highlighting is off for now: Shiki writes `style=""` attributes, which the CSP blocks. A highlighter that emits classes can come with the visual design.
- "Last updated" comes from the `updated` frontmatter field. Deriving it from git history is not done yet.

## Consequences

Pages without the search island would ship zero JavaScript, but the island is in the shared layout, so every page loads it on idle. The visual design can move it.
