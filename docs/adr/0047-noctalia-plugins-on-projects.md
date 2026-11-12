# 0047. Noctalia plugins on /projects

Status: accepted, 2026-11-12. Amends ADR 0025 (a section after the groups that is not a featured project) and ADR 0046 (13 featured projects; headroom is gone).

## Context

Three of the owner's Noctalia shell plugins are published in [noctalia-dev/community-plugins](https://github.com/noctalia-dev/community-plugins): `headroom`, `binance` and `obs-control`. Noctalia installs them from that repository. headroom was a featured project with its own page, but its repository, `ayagmar/headroom`, is archived, and binance and OBS Control were not on the site at all.

A plugin is a directory in someone else's repository. It has no stars, releases or merged pull requests of its own, so the featured-project machinery (numbers, log, feeds, a page) would show nothing true about it.

## Decision

- headroom leaves `featuredProjects` (13 remain) and `content/projects/`. It was `pull: false`, so the projects pull loses nothing and the GraphQL query one alias.
- `content/noctalia-plugins.json` lists the plugins in display order: the directory, the `name` from its `plugin.toml` and one line on what it does. `noctaliaPluginsSchema` in `apps/site/src/lib/noctalia-plugins.ts` validates it as the `noctaliaPlugins` collection, so a missing or unknown field, an empty summary or a repeated directory fails the build.
- /projects shows them after the groups under "Noctalia plugins", in the same row markup, each linking its directory on `main`. `projects.txt` ends with the same block, and the section is in the Pagefind index. With an empty list neither shows it.
- Plugins are not featured projects: no page, feed, numbers, log, sitemap entry, `llms.txt` line or home page row, and posts cannot name them in `projects`. A plugin that should have a page becomes a featured project with its own repository.
- No thumbnails: the plugins' images live in the other repository and the CSP allows no image from it, and the site has no pipeline for copying them in.
- `/projects/headroom`, its `.txt` and its feeds answer 404. The site has no redirect mechanism: static assets serve `dist/`, and the Worker's only redirect is `/room` (ADR 0045). A `_redirects` file would be a new mechanism for one page.

## Consequences

A stored `project-events` snapshot that still names headroom, or an older signals answering during the deploy, changes nothing: the site looks entries up by featured slug and ignores the rest (`test/projects.test.ts`). The `ok` fixture's project with an empty log is now dotfiles.

Adding a plugin is one entry in the JSON file, checked against its `plugin.toml` and README.
