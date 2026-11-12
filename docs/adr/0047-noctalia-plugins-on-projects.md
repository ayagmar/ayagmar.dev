# 0047. Noctalia plugins on /projects

Status: accepted, 2026-11-12. Amended 2026-11-12: each plugin shows its `thumbnail.webp`, copied into the site (ADR 0048). Amends ADR 0025 (a section after the groups that is not a featured project) and ADR 0046 (13 featured projects; headroom is gone).

## Context

Three of the owner's Noctalia shell plugins are published in [noctalia-dev/community-plugins](https://github.com/noctalia-dev/community-plugins): `headroom`, `binance` and `obs-control`. Noctalia installs them from that repository. headroom was a featured project with its own page, but its repository, `ayagmar/headroom`, is archived, and binance and OBS Control were not on the site at all.

A plugin is a directory in someone else's repository. It has no stars, releases or merged pull requests of its own, so the featured-project machinery (numbers, log, feeds, a page) would show nothing true about it.

## Decision

- headroom leaves `featuredProjects` (13 remain) and `content/projects/`. It was `pull: false`, so the projects pull loses nothing and the GraphQL query one alias.
- `content/noctalia-plugins.json` lists the plugins in display order: the directory, the `name` from its `plugin.toml` and one line on what it does. `noctaliaPluginsSchema` in `apps/site/src/lib/noctalia-plugins.ts` validates it as the `noctaliaPlugins` collection, so a missing or unknown field, an empty summary or a repeated directory fails the build.
- /projects shows them after the groups under "Noctalia plugins", in the same row markup, each linking its directory on `main`. `projects.txt` ends with the same block, and the section is in the Pagefind index. With an empty list neither shows it.
- Plugins are not featured projects: no page, feed, numbers, log, sitemap entry, `llms.txt` line or home page row, and posts cannot name them in `projects`. A plugin that should have a page becomes a featured project with its own repository.
- No thumbnails: the plugins' images live in the other repository and the CSP allows no image from it, and the site has no pipeline for copying them in.
- `/projects/headroom` answers a 301 to `/projects#noctalia-plugins` from the site Worker, the way `/room` redirects (ADR 0045); `moved` in `worker/index.ts` holds it, for every client, since curl following it gets the text copy of /projects anyway. The section carries that id.
- `/projects/headroom.txt` answers a 301 to `/projects.txt` from `public/_redirects`, which Workers static assets apply before serving a file. The Worker never sees it: `run_worker_first` keeps every `.txt` off the Worker (ADR 0040), and Wrangler refuses a rule for one `.txt` under `/projects/*`. Running every copy through the Worker for one old URL would cost a Worker run per copy. Its feeds answer 404; they never carried an item, as no post named headroom.

## Consequences

A stored `project-events` snapshot that still names headroom, or an older signals answering during the deploy, changes nothing: the site looks entries up by featured slug and ignores the rest (`test/projects.test.ts`). The `ok` fixture's project with an empty log is now dotfiles.

Adding a plugin is one entry in the JSON file, checked against its `plugin.toml` and README.
