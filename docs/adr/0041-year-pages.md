# 0041. Year pages

Status: accepted, 2026-11-06. Amended 2026-11-11: each year has its own link-preview image, and the home page's Shipping panel links the latest year (see Search and The way in). Amended 2026-11-06: the calendar opens on the first month with data, and a day with no record in it is a faint square, not an outline. Amends ADR 0038 (`readHistory` names the months that failed) and ADR 0015 (the fixtures gain a history of their own).

## Context

Signals keeps a row per series per calendar day for good (ADR 0038), and the only overview of it is the 28-day strip. A reader who follows a square to its day page has no way to see the year around it. The build already reads every month of both series, so a page per year needs no new source, route or schema.

## Decision

`/YYYY` (`src/pages/[year].astro`) is built from `src/lib/years.ts`, which counts and words everything; the page only renders it. The build date comes in as an argument from `getDays`, never from `new Date()` in the model.

**Which years.** A year has a page when it has a recorded day in either series, something published, or a month that failed to load. The last is there because an unknown month may hold records, and an indexed page must not disappear because a read failed. A year with none of these has no page and no link. The route is static, so only those paths exist: any other top-level path is still the 404 page.

**The calendar is twelve small months, not one 53-week grid.** A square is a link, so it needs 24 px around it (WCAG 2.5.8, as for the strip in ADR 0038); 53 columns give 13 px in the reading column and 5 px at 320 px. A month reflows whole: three across in the full column, one under the other on a phone, where the page is long but nothing scrolls sideways. It also settles the awkward cases. A week that straddles 1 January is split between December and January, each row runs Monday to Sunday, and no week is numbered, so ISO week years never come up. The strip does not align to weekdays at all, so the two share a scale and not a grid. The squares, their labels, the levels and the caption's words are the strip's own (`stripCells`, `stripOf`, `stripWords` in `src/data/format.ts`, `HeatDay.astro`), levelled over the days the calendar shows (ADR 0037), and `e2e/contrast.spec.ts` holds the calendar to the strip's contrast rule.

**Two calendars, never added.** Shipping counts UTC days and agent usage days in Rabat, in separate sections, each with the day pages' line naming its zone. Each series also has its own "today", since on 31 December 2025 it was 2026 in Rabat an hour before it was in UTC. No figure combines the two.

**Unknown is not zero.** `readHistory` used to return null for a whole series when one month failed; it now returns the days it could read and names the failed months in `failed`. Day pages and receipts still treat such a series as unknown (`wholeSeries`), so their behaviour is unchanged. A year page draws a failed month as "Could not be read." with no squares, and leaves out that series' facts and totals for that year, saying why. Leaving them out was chosen over marking them partial: "busiest day" or "longest run" over a year with a hole is a claim the page cannot back. Months that loaded still draw, and other years and the other series are untouched. A recorded zero is a quiet square, as on the strip. A day without a record inside a shown month is nearly invisible rather than the strip's outline: most of a young year is such days, and outlines outweighed what was recorded. The caption calls them faint, and each square's label still says "no record". A month of usage without a record says "No record", never 0.

**The calendar opens on the first month with data.** Each series starts at its first month with a record or a failed read, since an unknown month may hold records; the months before it are not drawn or listed. They are still counted as dates without a record below, so the facts and the coverage line do not change.

**A date without a record is unknown too.** Unlike a failed month it cannot hide the facts: shipping recording began on 3 October 2026, so that rule would blank every year so far. So each series compares its recorded days with the dates that have happened in the year. When some are missing, its facts stay but read "on record" ("Busiest day on record"), a line says how many days they rest on ("Counted over 34 recorded days of 310; the rest have no record."), and usage's sums read "at least", its total row "On record". "Nothing shipped." and "The year" are said only of a year recorded whole. The build day's own row counts too, so a year missing only today reads "on record" until it arrives.

**The current year.** Each series is cut at its own today before anything counts it, because a month's block holds whatever is stored for it and a clock a few minutes ahead can store tomorrow. Squares stop at the build date, months that have not begun are left out, and facts say "so far". Production rebuilds only on merges, so "so far" means as of the caption's "Counted up to".

**Runs.** The longest run counts consecutive dates with something shipped inside the year; a day without a record ends it. A run that crosses New Year is counted in each year for its own days and says so ("on into 2027"), and only when the next day has a record, so a run is never carried into an unknown month. Ties go to the earliest.

**Usage.** Tokens, estimated agent time and days used per month. `activeMs` absent is unknown (ADR 0014): a sum missing it on some days, or missing some dates, reads "at least", and one with none "Not known". Cost is not shown (ADR 0015).

**Search.** A year page has text of its own, so it is indexed, with its own title and description, and the sitemap follows. Its link-preview image (`/og/year/YYYY.png`, `renderYearCard` in `src/lib/og-card.ts`) is the year, its shipping calendar as one row of Monday-first weeks under the month names, and up to three figures under it: PRs merged and days shipped, then agent tokens, then what was published. The calendar opens on the week of the first month the page shows, and an unread month reads "unread" under its name. The figures come from the model (`figures` in `src/lib/years.ts`), counted from the same sums as the page's facts and left out wherever the page leaves out a series' totals. The page's "on record" and "so far" are said once, in the line under the year ("The year so far, on record"), not on each figure. The card draws only days with a record, so it depends on the history alone and not on the build date: a fixtures build draws the same image every day of that year. Its text alternative names the calendar's range, the months marked unread, and the figures with the same qualifier once. A year that only says it could not be read is `noindex` until the next good build.

**The way in.** A link under the strip on /stats, to the latest year, and one on every day page, to that day's year. /stats is where someone looking at numbers asks what came before the last 28 days, and a day page is where the square led them. The home page's Shipping panel has the same link in its head, beside "More" and styled like it: with only /stats leading there, the pages were hard to find, and a quiet link in the head costs the room nothing. The header is unchanged (ADR 0035).

**Fixtures.** `historyFixtures` (`fixtures/<series>/history/ok.json`, invented) holds the days before the `ok` block, in a directory of its own since it is longer than one block's 31 days. Fixtures mode reads both month by month. The history stops on 28 September, before the strip's window, so the strip's outlined days and the tests on them stay as they were.

## Consequences

- Fixtures builds now make about 320 more day pages, with no effect on any page's budget. `/2026` weighs 34 KB gzip without fonts and adds no JavaScript.
- With signals down, each year since 2025 builds with its empty state and is left out of the sitemap, so the page returns to search only after the next build that reads it.
- A failed month hides a year's facts until the next build, which is the price of never showing a wrong one.
- Listening per day is not part of this; it needs a series of its own.
