# Contributing

## Posting

1. `just post "Title of the post"` writes `content/writing/<slug>.md` as a draft. The slug is the URL: `/writing/<slug>`.
2. Write the post in Markdown. Run `PUBLIC_SHOW_DRAFTS=1 just dev` and read it at `http://localhost:4321/writing/<slug>`; without the variable, drafts are left out.
3. Set `draft: false` and open a pull request. Cloudflare builds a preview of the site for the branch.
4. Merge. `main` deploys to ayagmar.dev, the feeds and search index included.

Frontmatter:

| Field      | Required | Rule                                                                 |
| ---------- | -------- | -------------------------------------------------------------------- |
| `title`    | yes      | Non-empty.                                                           |
| `date`     | yes      | `YYYY-MM-DD`, the publish date.                                      |
| `updated`  | no       | `YYYY-MM-DD`, not before `date`. Shown as "last updated".            |
| `summary`  | yes      | One sentence. Used in lists, feeds and search.                       |
| `tags`     | no       | Lowercase slugs like `rust` or `home-lab`, no repeats.               |
| `series`   | no       | A lowercase slug shared by the posts of a series.                    |
| `draft`    | no       | `true` keeps the post out of production builds. Defaults to `false`. |
| `projects` | no       | Slugs of the featured projects the post is about, like `[runnerd]`.  |
| `art`      | no       | Art above the title; see below. Posts without it get none.           |

Any other field fails the build, so a typo such as `sumary:` does not pass silently. The error names the file and the field.

`art` draws a small picture above the title at build time, in the room's colours ([ADR 0027](docs/adr/0027-room-details-and-per-post-art.md)):

```yaml
art: { kind: dither, palette: night, seed: 2 }
```

`kind` is `ascii`, `dither` or `pattern`. `palette` is `night` (the default), `lamp`, `screen`, `zellige` or `wood`. `seed` is a whole number, 0 by default; change it until you like the picture. The same post and seed always give the same picture.

"Last updated" comes from `updated` in the frontmatter. Deriving it from git history is not done yet.

### Diagrams

Write a Mermaid diagram in a `mermaid` code block. It becomes an SVG when the site builds; readers get no JavaScript. Every diagram needs a name for screen readers, given one of two ways:

````md
```mermaid
flowchart TB
  accTitle: How a post is published
  accDescr: A draft is reviewed in a pull request, then merged and deployed.
  draft[Draft] --> review[Pull request] --> live[Deployed]
```

```mermaid title="Posts per month"
pie
  "September" : 3
  "October" : 5
```
````

- `accTitle:` names the diagram without showing the name; `accDescr:` adds a longer description.
- `title="..."` after `mermaid` names the diagram and shows the text as a caption below it. It is the only option the code block accepts.

The build fails, naming the file and line, when a diagram has no name, has a Mermaid error or uses an unknown option. Check how it looks with `just dev`. Prefer `flowchart TB` to `LR` once a flowchart has more than three nodes: a wide diagram shrinks on phones, text included. Any diagram type Mermaid 12.1 supports works ([Pele](https://pele.run) renders them); colors come from the site theme, so leave out `style` and `classDef` unless a color carries meaning.

## TIL notes

A note is a short "today I learned" in `content/til/<slug>.md`; the slug is the URL, `/til/<slug>`. Frontmatter is `title` and `date` (`YYYY-MM-DD`), plus optional `tags` (the posts' rules) and `draft: true`. Any other field, `summary` included, fails the build. The body is a few lines to a few paragraphs of Markdown, with the same code blocks and diagrams as posts. `/til` shows every published note in full, newest first; `/til/feed.xml` and `/til/atom.xml` carry them, and the writing feeds do not. Feeds use the note's first paragraph as its summary. Read drafts with `PUBLIC_SHOW_DRAFTS=1 just dev`. Details: [ADR 0028](docs/adr/0028-til-notes.md).

## Skills

`/skills` shows the public skills in [ayagmar/agents-skills](https://github.com/ayagmar/agents-skills). The page reads `content/skills.json`, never the network or a checkout. After a skill changes there, `just skills-sync --evals ~/projects/agents-skills/eval-results` rewrites the file from the repo's `main` (add `--from <checkout>` to read a local copy instead) and prints a warning for each skill it had to fill in from a fallback. The eval results are not tracked in that repo, so pass them from the local checkout or the shelf loses its eval lines. Commit the file as `chore(content): sync skills`. Details: [ADR 0031](docs/adr/0031-skills-shelf.md).

## Projects

The featured projects are listed in `packages/contracts/src/projects.ts`. Each gets a page at `/projects/<slug>` and feeds at `/projects/<slug>/feed.xml` and `atom.xml`. A post with `projects: [<slug>]` shows that project's card and appears on its page.

To describe a project, add `content/projects/<slug>.md`:

```md
---

slug: runnerd
status: active # active, maintained, archived or spec
tagline: 'One line shown under the name.' # optional
subdomain: runnerd # optional: links https://runnerd.ayagmar.dev
order: 1 # optional: lower comes first on /projects
---

The long description, in Markdown.
```

The build fails when `slug` is not a featured project or differs from the file name, and warns about featured projects that have no file.

## Styling

The design is the late-night room ([ADR 0026](docs/adr/0026-visual-design-late-night-room.md)).
- Colors are tokens in `apps/site/src/styles/base.css`, each a `light-dark(day, night)` pair. Use a token, not a raw color, and check both themes: the switch in the header, or your system's dark mode. `just e2e` runs axe in both.
- A surface (`.paper`, `.panel` with a material class such as `.m-screen`) sets `--bg`, `--fg`, `--fg-2` and `--accent`; draw with those inside it.
- No `style=""` attributes or inline `<style>`/`<script>`: the CSP blocks them (ADR 0019).
- The home page room is drawn by `apps/site/scripts/scene.py`. Change it, run `just scene`, and move the object's hotspot rectangle in `src/styles/room.css` if the object moved. Hotspots and the list under the scene come from `src/lib/room.ts`.
- The room's details (the window's sky and moon, the lamp after 02:00, the turning record, the `?` keys, the ASCII room for `curl`) are in [ADR 0027](docs/adr/0027-room-details-and-per-post-art.md), with how to see each one. If you move the window in `scene.py`, move the moon in `src/scripts/room.ts` too.
- Fonts are subsets built by `just fonts`. Add characters to `UNICODES` in `scripts/fonts.py` if a post needs glyphs outside Latin-1 and common punctuation. Both recipes need `uv` (`mise install` provides it).

## Code changes

- Every command is a `just` recipe. CI calls the same recipes.
- Run `just check` and, for anything that changes pages or the site Worker, `just e2e` before opening a pull request.
- The units depend on each other in one direction only (see [ARCHITECTURE.md](ARCHITECTURE.md)). `just boundaries` fails otherwise.
- New dependencies need a line in [docs/adr/0020-dependency-policy.md](docs/adr/0020-dependency-policy.md) and an exact version.
- Record decisions in `docs/adr/` (copy the shape of an existing one).

## CI checks

One workflow, `.github/workflows/ci.yml`, runs on every pull request and on `main`. It runs only the jobs your change needs and a `gate` job that passes when each of them passed; `gate` is the only required check. [ADR 0018](docs/adr/0018-ci.md) lists which paths run which jobs. `just ci-plan` shows the jobs for your branch against `origin/main`.

Each job runs `just` recipes, so you can run the same thing locally. Recipes that need a pinned tool (gitleaks, lychee, osv-scanner, actionlint, zizmor, shellcheck, shfmt) download it into `.tools/bin` on first use (Linux x86_64).

| Job              | Locally                                                                 |
| ---------------- | ----------------------------------------------------------------------- |
| `format`         | `just fmt-check` (`just fmt` fixes it)                                  |
| `secrets-source` | `just scan-secrets-source`                                              |
| `checks`         | `just lint typecheck knip boundaries test-scripts`                      |
| `contracts`      | `just contracts-schema-check test-contracts`                            |
| `site-test`      | `just test-site`                                                        |
| `site-build`     | `just site-build site-dist-check scan-site`                             |
| `e2e`            | `just e2e` (builds first; `just e2e-install` once for Chromium)         |
| `links`          | `just links` after a build (`just links-internal` skips external links) |
| `signals-test`   | `just test-signals signals-build scan-signals`                          |
| `osv`            | `just osv`                                                              |
| `workflows`      | `just workflows-lint ci-test ci-policy`                                 |
| `renovate`       | `just renovate-check`                                                   |
| `shell`          | `just shell-lint`                                                       |
| `budgets`        | `just budgets` after a build                                            |
| `lighthouse`     | `just lighthouse` after a build (`--profile desktop` for one profile)   |
| `codeql`         | CI only                                                                 |

Lighthouse runs when a change can affect the built site; add the `lighthouse` label to a pull request to run it anyway. On pull requests from this repository it posts one comment with each page's numbers, base → head, and updates it on every run.

CI never deploys and has no Cloudflare credential. Do not add a workflow step that calls Wrangler or a recipe that deploys; `just ci-policy` fails if you do.

## Performance budgets

Every page has a budget, checked on the built site and failing CI when exceeded. [ADR 0017](docs/adr/0017-testing-and-budgets.md) gives each number its reason; the numbers live in `scripts/budgets.json`.

| Check                                             | Budget                                                                                  |
| ------------------------------------------------- | --------------------------------------------------------------------------------------- |
| JavaScript a page loads, gzip                     | 0 B without islands, 20 KB with islands; the theme script apart, at most 1 KB           |
| Page weight: HTML, CSS, JS, images, gzip for text | 150 KB, fonts excluded                                                                  |
| Fonts, the whole build                            | 200 KB, woff2 only                                                                      |
| Requests to other origins from HTML or CSS        | none: self-host fonts, images and scripts                                               |
| `<img>`                                           | `width` and `height` on every one, as positive whole numbers                            |
| Lighthouse, mobile and desktop (median of 3)      | performance ≥ 0.95, accessibility 1, best practices ≥ 0.95, CLS ≤ 0.01, TBT ≤ 100 ms    |
| Lighthouse LCP                                    | ≤ 2.0 s mobile, ≤ 1.0 s desktop                                                         |
| Against the base branch                           | LCP no worse than +10 % and +200 ms on mobile, +100 ms on desktop; TBT +10 % and +50 ms |

`just site-build` then `just budgets` prints a table per page. `just lighthouse --profile desktop` runs Lighthouse locally on the build (Chromium from `just e2e-install`; about three minutes). To change a budget, edit `scripts/budgets.json` and the reason in ADR 0017 in the same pull request.

## Commits and merges

- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org): `feat: ...`, `fix: ...`, `docs: ...`, `chore: ...`. Pull request titles use the same form; they are the project history.
- Branches are named `<type>/<topic>`, for example `feat/now-playing`.
- Pull requests are merged with a merge commit. Do not squash.
