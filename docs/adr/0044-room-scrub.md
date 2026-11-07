# 0044. Scrubbing the room through past days

Status: accepted, 2026-11-06. Amended 2026-11-06: shipping and usage are worded `on record`, the control needs Rabat's current rules, a failed load of its code recovers, and the slider has a date anchor. Amends ADR 0043 (the `past` moment, what home's script loads), ADR 0038 (the site reads all four series), ADR 0029 (the credit's note of changes) and ADR 0017 (on-demand chunks, allowances).

## Context

Signals keeps a row per series per day for good (ADR 0038), and the room only ever shows now. ADR 0043 left a `past` moment for this, and said it would need a reader for `/v1/days`. The owner wants a reader to drag the room back through the days and see it as it was: quiet, exact, and never a false claim.

## Decision

**One slider under the room.** A native `input type=range`, styled as a hairline with a small lamp mark, inside `.room` on home. Its value is days back from today, `0` being now, so it starts at the right end with no script, and its keys are the browser's own: Left and Right a day, Home the first day, End now. It holds an input, so the keys 1 to 7 (which ignore inputs) and search never meet it. Under it the date in words, "Read this day", "Back to now", and one line per fact. "Back to now" returns focus to the slider.

**Range.** From the first date any of the four series holds, read at build into `data-from`, to yesterday in Rabat, with now as one more stop at the right end. Without such a date, or without scripts, there is no control: `room.css` shows it only under `data-theme-switch`, set before the first paint, so the band is there at once and nothing shifts.

**Only with Rabat's current rules.** Without them (`knowsRabat`) the browser's date flips an hour early, so at 23:30 UTC today would be offered as a finished day, and its hours and day ends are off too. `room.ts` removes the control there, which is the one case where the band moves after the first paint.

**The axis has an anchor.** The slider's numbers count from `anchor`, the today they were set against. A value is read on that axis (`dateAt`), and the axis then moves to today, keeping the held date. It also moves before a key or a press reaches the browser, on a return to the tab or window, on a restored page, and every minute. So midnight leaves the date held and a step means one day from it: Right from the day before yesterday reaches the new yesterday, not now.

**21:00 in Rabat, every date.** Fixed rather than the reader's time of day, for three reasons. It is dark all year, so the moon shows its phase and a drag shows it waxing and waning; at noon every day would look alike. A fixed hour keeps the sky from changing for no reason as a reader moves. And it is the hour the weather's night slot speaks for. It comes from `rabatDayStart`, so it follows the offsets before 20 September 2026 and the Ramadan changes; a clock change that day moves it an hour, as for the weather's slots. The hour is never shown, because it only draws the sky. The lamp is on and the cat is absent every past evening: they follow the same hour and say nothing.

**A past date is a day summary.** This replaces ADR 0043's `past` row. That filtered the snapshot's events and scrobbles by instant, and made no claim about a day's total. Records are what a date came to, so the words name the date and never an instant inside it, and the old filters are gone with their tests. `roomState(inputs, { kind: 'past', instant, day })` takes the clock's sky and moon and the shelf's posts from the instant, and everything else from `day`, worded once by `dayFacts` in `src/lib/room-day.ts`.

| Object | Source                                 | Says                                                                              | No record                             | Read failed                             |
| ------ | -------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------- | --------------------------------------- |
| Pins   | `/v1/days/shipping-activity`, UTC date | `2 merges · 5 commits in 1 push on record for 14 Oct, UTC`, a note per repository | `No shipping on record for 14 Oct`    | `Shipping for 14 Oct could not be read` |
| Screen | `/v1/days/llm-usage`, eleven weeks     | `2.2M tokens on record for 14 Oct`                                                | `No agent usage on record for 14 Oct` | The same pattern                        |
| Record | `/v1/days/listening`                   | `Last played X by Y · 14 Oct, 21:28. 27 plays on 14 Oct`; never playing           | `No listening on record for 14 Oct`   | The same pattern                        |
| Window | `/v1/days/weather`, the night slot     | `slight rain at 22:00`, and `from Open-Meteo's archive` if it is                  | `no weather on record`                | `its weather could not be read`         |
| Shelf  | The seed's posts, by date              | As live                                                                           | Never                                 | Never                                   |

- A checked zero of listening is said as one: `Nothing played on 14 Oct`. Only it may say nothing happened.
- **The board holds that day only**, not the newest six up to it, so it needs one block and changes as a reader moves. A day's names can be withheld (ADR 0038): with counts and no name it pins the day itself.
- **As-of comes only from the row.** A listening row has its own `asOf`, so one read before its date ended says `, so far, as of 26 Oct, 09:00`, and only a row read after it may say `Nothing played`. A block's `fetchedAt` dates the source's latest snapshot, not a row: pushes rewrite only the newest 35 days, so a morning's row can sit unchanged under a block fetched months later. Shipping and usage rows carry no time of their own, so they say `on record`, which never claims the whole day, zero included. Serving `daily.updated_at` would need a change to the frozen day schemas for a word or two, so it was left.
- **Weather is the night slot alone.** The window is dark, and the 13:00 reading says nothing of it. Null, or a code the table does not know, is `no weather on record`, with no layer.
- While a block is on its way a fact is `Reading…`, never "no record". The Listening panel below the room stays live and true throughout; only the scene goes back.

**Data.** No block is asked for until the slider moves; focus alone loads the code and `/day/index.json`. A date asks for its month of shipping, listening and weather and the three or four months of usage the screen spans, at most seven blocks, once it has held for 200 ms, so a drag asks only where it rests. What shows is always worked out from the held date and the blocks held at that moment, so a late answer can only fill in the date it belongs to: nothing needs cancelling, and an answer after a return to now changes nothing. A failed month is unknown for that source alone, and is left for a minute before it is asked again. Blocks stay in memory for the page. Hand-written readers hold each day to the contract, without zod; one bad day fails its block, and usage keeps a date and tokens, so no cost reaches the room (ADR 0014).

**A failed load.** If the code cannot load, on first touch offline or after a deploy has removed the old chunk, the room stays live, the slider returns to now, a line says so as an alert, and the next touch asks again.

**Back to now.** The live answers keep arriving behind a past day, and `room.ts` keeps them. Returning redraws from `roomState` at this instant, through the same markup the build used (`src/lib/room-markup.ts`), so `e2e/room-scrub.spec.ts` compares the scene to what it was, to the character.

**Links.** "Read this day" goes to `/day/<date>` only when that page exists. `/day/index.json` lists them, as a date's page depends on what the build held and the browser cannot work that out. The URL stays clean: a `#day=` fragment would need restoring on load, which means asking for blocks before any touch.

**Announcements.** The slider's `aria-valuetext` is the date, which a screen reader reads as the slider moves, as it does any slider. The facts go to one polite `status` region 800 ms after a date settles and its months are answered, so a run of key presses says one thing.

**Fixtures.** A fixtures build writes its months to `/sample/days/<series>/<month>.json`, so a Preview scrubs through sample days from its own origin and still makes no request to signals. An `api` build has no such paths. `data-days-src` is the only difference. Listening and weather gain fixtures; the sample days cover a checked zero, a date with no row, an open day, null and unknown night slots and archived readings.

**What home loads.** `src/lib/room-clock.ts` is now what home's script runs: window, lamp and record. `roomState` adds the objects from `room-state.ts`, which ADR 0043 kept in the browser only for the scrub, so they moved behind the `import()` with it. Vite wraps every `import()` in a preload helper of about 750 B, even with `modulePreload: false`, so `astro.config.ts` swaps it for a no-op: home's one dynamic import has no CSS or imports worth preloading ahead. `scripts/budgets.ts` takes `*` in `onDemand` and holds such a chunk to its allowance.

## Measured

Built import graph, `gzip -9` on each file, summed: a page's entry script and the chunks it imports.

| Page            | Before  | After   | Change |
| --------------- | ------- | ------- | ------ |
| Home            | 7,933 B | 7,089 B | −844 B |
| /stats          | 9,609 B | 9,883 B | +274 B |
| /uses           | 3,469 B | 3,580 B | +111 B |
| Scrub, on touch | none    | 4,723 B | new    |

The scrub is `room-scrub.*.js` (4,115 B) with the `heat.*.js` (499 B) and `plural.*.js` (109 B) chunks. /stats and /uses grow because the shared chunks split again, not because they do more: each extra chunk compresses alone. Home's HTML grows by 245 B gzip, and the stylesheets by 1.4 KB before gzip.

Rollup names a chunk after its first module, so the live reads chunk is now `rabat-date.*.js` (1,880 B, cap 1,900 B) and the listening reads chunk `listening.*.js` (1,669 B, cap 1,840 B). The room clock's cap falls from 4,350 B to 3,830 B, about 8 % over what it now measures, and the scrub's is 4,460 B on its entry file, as `budgets.ts` measures it.

## Consequences

- The scrub reaches back only as far as the records. Listening and weather begin at the first deploy of ADR 0038's series or at a backfill's `from`; earlier dates read `No listening on record`.
- The build reads two more series month by month: two more reads per month served, one cache entry each.
- A month's block is held for the page's life, so a block read this morning stays as it was.
- A date after a held block was read reads as no record until the next load.
- `on record` is said of every shipping and usage day, however complete: the rows cannot tell a whole day from a part of one.
- The corkboard shows that day's repositories, so a return to now can change it a lot. That is the true difference, not a leftover.
- `/v1/days` answers `https://ayagmar.dev` only (ADR 0010). A Preview works because it reads its own sample files.
