# 0031. Skills shelf

Status: accepted, 2026-10-26

## Context

The owner keeps 13 public Agent Skills in [ayagmar/agents-skills](https://github.com/ayagmar/agents-skills), each its own npm package. The site should show them: what each does, how to install it, and how it did on its evals.

Constraints from earlier ADRs: the build reads no network and no local checkout of another repo (ADR 0015), the CSP allows no new inline script (ADR 0019), and nothing private may reach a published page. The eval results the owner has are not private-safe as they are: each file holds absolute home paths, cost figures, judge prompts and transcripts.

## Decision

### Data: a committed allowlist

`just skills-sync` runs `scripts/skills-sync.ts`. It reads a checkout of the skills repo (a shallow clone of `main` by default, or `--from <dir>`) and writes `content/skills.json`. Every field is copied by name from a known place, so a new field in the source never reaches the site on its own:

| Field                                   | From                                                                                                                                                                                |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`, `package`, `version`, `license` | the plugin's `package.json` and `SKILL.md` frontmatter                                                                                                                              |
| `summary`, `runtime`                    | the row for the skill in the root README's skills table; `package.json` `description` when there is no row (a warning), no runtime then                                             |
| `install`                               | the `npx skills add ... --skill <name>` line in the plugin README, verbatim                                                                                                         |
| `credit`                                | `metadata.sources` in `SKILL.md`, else the first paragraph of the README's Credits section, links reduced to their text                                                             |
| `readme`, `npm`                         | built from the plugin directory and package name                                                                                                                                    |
| `eval`                                  | `eval-results/<name>/aggregate-result.json`: `casesPassed`, `casesTotal`, `suite.threshold`, the start date, `suite.modelOverride` and the version of this skill in `suite.plugins` |
| `source`                                | the repo, and the commit SHA and date of the checkout                                                                                                                               |

A skill with no results file has `eval: null`. A results file that is not what the script expects (no totals, more passed than run, no entry for the skill, an unparseable date) fails the run and names the file; a result marked `partial` is left out with a warning. The script refuses to write a file in which a regular expression finds `/home/`, `/Users/`, `~/.`, an email address, or any rule of `scripts/scan-secrets.ts` matches. `scripts/skills-sync.test.ts` runs the script on a small fixture repo with each of those cases, and checks that the committed file passes the same test and holds only the allowlisted keys.

The eval results are not tracked in the skills repo (`eval-results/` is gitignored there), so a clone of `main` has none. The recipe takes `--evals <dir>`; without it, evals come from `<from>/eval-results` when that exists. The owner's runs are for older versions than the current ones (0.1.1 against 0.1.2, say), so the page shows the version a run was against and "(now X)" when it differs, instead of passing it off as a result for the current release.

The site validates the file at build with `skillsSchema` (`src/lib/skills-schema.ts`), loaded through a content collection like `about.json`. The schema is strict: an unknown field, a repeated skill or a pass count above the total fails the build.

### Page

`/skills` is one page on the room's ground (no panel behind it), with no client JavaScript. An intro says what an Agent Skill is, then shows the install command once as a pattern (`npx skills add ayagmar/agents-skills --skill <name> --agent <agent>`, derived from the first skill's own line) with the agent ids. The skills sit on five shelves by what they are for: Plan, Review, Delegate and ship, Write, Read and recall. The grouping is a list in `src/lib/skills.ts`; a skill the sync brings that no shelf names goes on a last "More" shelf so it still shows, and a unit test fails until it is placed.

Each skill is a jar: a strip of the notebook's paper as its label (name and version) on a dark body with a wooden base, so the shelf holds what the writing desk holds. The body has the one-line purpose, quiet badges (licence, "needs Node" only for skills that do, the eval result as a bare ratio such as 3/3, in the glow colour when every case passed and the rose colour when not), the README and npm links, any posts tagged with the skill's name, and the credit line where there is one, in small type. A `<details>` opens the skill's own install command, the eval result in words (cases passed, pass mark, date, model, the version it ran against and "(now X)" when that differs) and the runtime. A failed case therefore shows on the card, not only in the detail. Styles are scoped to the page, built to a stylesheet file, and use tokens only.

The page is in the sitemap, in `index.txt` as one line, and in the search index as one result titled "Skills" (the page carries `data-pagefind-body` and a hidden `data-pagefind-meta="title"`, like a TIL note). It shows the tag page for `skills` when a published post has that tag. The header link is added with the reader redesign; until `nav` lists the page, `renderPlainText` adds the line itself.

The first version put every skill in one wood slab, one row each with its install line, an eval sentence and the links; it read as a data dump, which is why the install line and the eval sentence moved behind the disclosure.

### No page per skill

A page per skill would add the full `SKILL.md` description and the names of the eval cases. The description is trigger text written for the agent ("Use whenever...", "Not for..."), and the README on GitHub is the maintained document for a reader. The case names are kebab-case ids with no prose. A page would be a second copy of the README that drifts, 13 more pages in the sitemap and in Lighthouse, and more of the source to allowlist. The `#name` anchors cover linking.

### Licensing

The skills repo is MIT, but two skills (`commit`, `summarize`) are Apache-2.0 adaptations of skills from mitsuhiko/agent-stuff; each entry shows its own licence and credit line. The shelf quotes metadata from that repo with attribution; the quoted text is short facts (names, versions, one-line descriptions, install commands), not the skill text. `content/skills.json` sits under `content/`, which is all rights reserved (ADR 0022), but its source is the skills repo and stays under that repo's terms.

## Consequences

- The shelf is as fresh as the last `just skills-sync`, by hand. The source commit and its date are on the page, so a stale shelf shows.
- Evals shown are the owner's local runs, not something a reader can reproduce from the repo today.
- Posts about skills use the `skills` tag; no post is written for this change.
