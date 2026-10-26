# 0025. Posts and projects

Status: accepted, 2026-10-26

## Context

Some posts are about one of the featured projects. A reader of such a post should see which project it is and how it is doing; a reader of a project should find everything written about it, and be able to follow only that project's writing.

## Decision

- The featured projects stay defined once, in `packages/contracts/src/projects.ts` (ADR 0008). The site adds no second list.
- `content/projects/<slug>.md` is optional per project: frontmatter `slug` (must equal the file name and be a featured slug), `status` (`active`, `maintained`, `archived` or `spec`), optional `tagline`, `subdomain` (the label in `<label>.ayagmar.dev`) and `order`, plus a Markdown body for the long description. Unknown fields fail the build. A slug that is not featured, or that differs from its file name, fails the build naming the file; the file-name check runs in a small loader wrapped around Astro's `glob` in `apps/site/src/content.config.ts`. A featured project without a file is a build warning, and its page shows GitHub data only.
- Posts list projects with `projects: [slug, ...]`, validated against the contracts list in `writing-schema.ts` (not with Astro's `reference()`, which would check against the optional files). An unknown slug fails the build; Astro names the post and the error names the slug.
- `apps/site/src/lib/projects.ts` builds one `SiteProject` per featured project from the contracts entry, the file and the projects snapshot. The slug is the project's name everywhere on the site, since it never changes. The summary is the tagline, else the GitHub description. Status comes from the file, else `archived` when GitHub says so. Pages, cards, the plain-text view and feeds only render this model.
- Every featured project gets `/projects/<slug>`, with description, live numbers (or "No live numbers for <slug> right now." when the snapshot has none), links, and the published posts about it, newest first. `/projects` lists every project with its post count. A post about a project shows a card for it, with up to three of the project's other posts, newest first.
- Per-project feeds `/projects/<slug>/feed.xml` and `atom.xml` come from the same feed model as the site-wide and tag feeds (ADR 0021): `buildFeed` takes a scope (`{ tag }` or `{ project }`), and the feed id is `tag:ayagmar.dev,2026:/projects/<slug>`. Entry ids do not change. The project page links its feeds for discovery. Every featured project gets feeds, empty ones included, so a reader can subscribe before the first post.
- Post pages mark each project link with `data-pagefind-filter="project"`; the search island shows "About <slug>" under a result. No new script.
- `index.txt` lists every project with its published post count.

## Consequences

Adding a featured project to contracts adds its page and feeds on the next build. Removing one fails the build of any post that still names it, which is the point. Drafts never count: post counts, cross-links and feeds all start from the published set.
