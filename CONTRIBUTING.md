# Contributing

## Posting

1. `just post "Title of the post"` writes `content/writing/<slug>.md` as a draft. The slug is the URL: `/writing/<slug>`.
2. Write the post in Markdown. Run `PUBLIC_SHOW_DRAFTS=1 just dev` and read it at `http://localhost:4321/writing/<slug>`; without the variable, drafts are left out.
3. Set `draft: false` and open a pull request. Cloudflare builds a preview of the site for the branch.
4. Merge. `main` deploys to ayagmar.dev, the feeds and search index included.

Frontmatter:

| Field     | Required | Rule                                                                 |
| --------- | -------- | -------------------------------------------------------------------- |
| `title`   | yes      | Non-empty.                                                           |
| `date`    | yes      | `YYYY-MM-DD`, the publish date.                                      |
| `updated` | no       | `YYYY-MM-DD`, not before `date`. Shown as "last updated".            |
| `summary` | yes      | One sentence. Used in lists, feeds and search.                       |
| `tags`    | no       | Lowercase slugs like `rust` or `home-lab`, no repeats.               |
| `series`  | no       | A lowercase slug shared by the posts of a series.                    |
| `draft`   | no       | `true` keeps the post out of production builds. Defaults to `false`. |

Any other field fails the build, so a typo such as `sumary:` does not pass silently. The error names the file and the field.

"Last updated" comes from `updated` in the frontmatter. Deriving it from git history is not done yet.

## Code changes

- Every command is a `just` recipe. CI calls the same recipes.
- Run `just check` and, for anything that changes pages or the site Worker, `just e2e` before opening a pull request.
- The units depend on each other in one direction only (see [ARCHITECTURE.md](ARCHITECTURE.md)). `just boundaries` fails otherwise.
- New dependencies need a line in [docs/adr/0020-dependency-policy.md](docs/adr/0020-dependency-policy.md) and an exact version.
- Record decisions in `docs/adr/` (copy the shape of an existing one).

## Commits and merges

- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org): `feat: ...`, `fix: ...`, `docs: ...`, `chore: ...`. Pull request titles use the same form; they are the project history.
- Branches are named `<type>/<topic>`, for example `feat/now-playing`.
- Pull requests are merged with a merge commit. Do not squash.
