# 0052. Wording for visitors: contact, search, /stats, the shipping log and /now

Status: accepted, 2026-11-12. Amends ADR 0035 (/now says its age and links projects on the site).

## Context

A UX audit of the live site, read from a visitor's side, found that a recruiter on a phone had to scroll past five certifications to find an email address, and that Search found nothing for "contact" or "email" because /about's links were left out of the index. Search took two Escapes to close and answered a miss with "No results." The 404 named a Search that was plain text and sent readers to "the room". /stats opened with how its dates work rather than what it measures, and its first label was Last.fm's "Scrobbles". Half of home's Shipping log was Renovate merges. /now linked each project to GitHub although the site has its page, and gave its date with no sense of how old it was.

## Decision

**Contact on /about.** One line under the summary: "Contact me by email at hello@ayagmar.dev, or on LinkedIn or GitHub." Its links come from `contactLinks` in `src/data/about.ts`, which "Elsewhere" also lists, so the two cannot drift. The line says "contact" and "email" in words because Pagefind indexes text, not `mailto:` URLs. "Elsewhere" is indexed again. The text copy carries the same line.

**Search.** One Escape closes the dialog: the field stops the native search field's first Escape, which only cleared it. Focus goes back where it was, as the dialog element does. A search that finds nothing says `Nothing for "<query>". Try Projects, About or Stats.`, the three links taken from the nav's entries (`searchFallback` in `src/lib/writing.ts`) and the query rendered as text. Any element with `data-search-open` opens the dialog; the 404's "Search" is such a button, drawn as a link. Without scripts the 404 still says only "Try one of these:", as before, and its last link is "the home page".

**/stats.** The intro is "What I listen to, ship, type and spend on coding agents, from my own tools. It updates while the page is open." The text copy starts with the same sentence and says its numbers are the last build's. Both come from `statsBuildWords` in `src/lib/stats.ts`. "Scrobbles this week" and "last week" become "Tracks played this week" and "last week". The Rabat-date rule is small print under On this day, which only shows with scripts.

**The shipping log leaves out dependency updates.** On home and in /stats' log (and so its text copy), a merge whose title starts with `chore(deps)` or `chore(deps-dev)` is not shown (`shippingLog` in `src/lib/stats-panels.ts`). `/v1/shipping` carries no author, so the bot list of ADR 0046 cannot be applied here, and the frozen v1 contract stays as it is; the title is what there is. A bot merge with any other title still shows. Counts, the strip, day pages, year pages and the room keep every merge. Home shows up to four of what is left and drops the section only when there is neither a strip nor an event. /stats says "Only dependency updates lately." when every recent event is one.

**/now.** A brewing item that is a featured project, by its name or its repository URL, links to `/projects/<slug>`; the text copy gives the full URL. The age follows the date, "Updated 30 October 2026, 13 days ago.", written by `src/scripts/now.ts` against the reader's clock, the way the out-of-date notice is, and again at the reader's midnight. The built HTML and the text copy say only the date, because a static page served weeks after its build cannot know its age.

## Consequences

A dependency update titled without `chore(deps)`, such as Dependabot's default "Bump x from 1 to 2", still shows in the log. Sending the author through `/v1/shipping` would need a v2 contract and a change in repo-pulse.

The budgets hold without a new allowance (`just budgets`, 2026-11-12, against main's build the same day). /stats loads 20,254 B of JavaScript outside the allowances, against 19,774 B on main and a budget of 20,480 B: the island's no-result sentence, its Escape handling and the 404's request (+194 B), the days' words in a chunk of their own (+249 B), and Svelte's runtime (+45 B). That chunk is shared with /now, which would otherwise load the whole `live` chunk for one function: `src/lib/days-ago.ts` imports nothing for that reason. The "Try Projects, About or Stats." links are HTML made at build time rather than a list the island renders, and "Only dependency updates lately." sits with the shipping panel's code, since the words chunk (`stats.*.js`) was at 1,649 of its 1,650 B.
