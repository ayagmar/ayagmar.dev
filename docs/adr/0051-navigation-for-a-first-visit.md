# 0051. Navigation for a first visit

Status: accepted, 2026-11-12. Amends ADR 0026 (the list's order), ADR 0027 (what the keys 1 to 7 open), ADR 0031 (the label and its place in the nav), ADR 0037 (the list on a phone, the Tab order on a wide screen) and ADR 0044 (the slider's caption).

## Context

A UX audit of the live site (12 Nov 2026) walked it as a recruiter, a developer looking for a tool and a keyboard user. Four things got in their way:

- The header and the phone Menu started with Writing and TIL, both empty, and ended with About. "Skills" read as a CV section and led to agent skills.
- On a phone, home's list named room objects ("Corkboard", "Tea set") that the cropped scene does not show, and put Projects fourth and About sixth.
- On home and /projects only a project's name was a link, 21 px tall, and the label on the right said "active" or "maintained" on almost every row.
- On a wide screen, Tab went through seven hotspots and then seven rows that lead to the same pages.

## Decision

**The nav's order.** `nav` in `src/lib/site.ts` is Projects, About, Writing, TIL, Agent skills, Stats. Writing and TIL stay while empty: the header should not change shape the day the first post goes out. The label is "Agent skills" in the header, the Menu, the page's title and heading, its search result and `index.txt`; the URL stays `/skills`.

**The list follows the nav.** `roomList` in `src/lib/room.ts` sorts `roomObjects` by where each page sits in `nav`, the three /stats sections where Stats sits, in the scene's order: Projects, About, Writing, TIL, Shipping, LLM usage, Music. The list, the keys 1 to 7 (which press the list's rows in order) and the Keys dialog all use it, so `1` opens Projects and `2` About. The hotspots keep the scene's left-to-right order, which is where they are. No second list exists to drift: reordering `nav` reorders the list.

**What a row says.** Below 60 rem a row's second line is what its page holds: "Tools I build", "Work and contact", "What I merged, by day", "My coding-agent use", "What I'm playing"; Writing and TIL give their newest title, or "No posts yet" and "No notes yet". From 60 rem, where the whole scene is in view, the line is the object's name, as before. Both lines are in the HTML and CSS shows one, so no layout depends on a script.

**Hotspots out of the Tab order from 60 rem.** The build gives every hotspot `tabindex="-1"`; `src/scripts/room.ts` removes it below 60 rem and puts it back above, as the window is resized. A pointer still uses them, and a focused or hovered row still lights its object. Each row carries the fact its hotspot says ("Shipped to runnerd on 12 Nov") in a visually hidden span, shown to screen readers from 60 rem, kept current by the same function that relabels the hotspot (`sayFact`), so the scrubbed past day and the record player's live line reach the row too. Without JavaScript no hotspot is a Tab stop at any width; the list under the scene reaches the same pages.

**Project rows.** One component, `ProjectRow.astro`, draws a row on home and on /projects. The name's link is stretched over the whole row with a positioned `::after`, so the row is one link for a screen reader, its name is the project's, and it is at least 44 px tall. The label beside the name is the strongest fact the snapshot has, from `projectFact` in `src/lib/project-row.ts`: stars from 10 ("118 stars"), else npm downloads over the last 30 days from 100 ("2.6k downloads a month"), else the latest release's tag, else nothing; then the post count; then "archived" when it is. Below those floors a number says less than the summary beside it. A project with no snapshot entry, one with `pull: false`, or a build with no projects snapshot shows no fact. The status stays on the project page.

**Kept current.** The rows sit in a `data-live="projects"` element, and `src/scripts/project-rows.ts` redraws every label from `/v1/projects` with the same functions the build used, every half hour while the page is open, as `project-live.ts` does for the project page. A project a newer answer leaves out loses its fact. In fixtures mode no request is made, and a "Sample data, not live" line marks the numbers, once on /projects and under home's list.

**The slider's caption** is "Drag to see the room on past days". Its `aria-label` stays.

## Consequences

The 404 page and empty /writing and /til list their way out in the nav's order, so Projects and About come first there too.

`index.txt` lists each project with the same label as its row, and its links column is two characters wider, for "Agent skills".

Home and /projects load `project-rows.ts`, under a kilobyte gzipped.

A row's summary can no longer be selected by dragging across it, since the link covers it.
