# 0043. The room shows what is true

Status: accepted, 2026-11-06. Amends ADR 0017 (budgets), ADR 0027 (the cat's hours, the record), ADR 0029 (when the room asks for weather, its allowance) and ADR 0045 (`RoomFacts`). Amended 2026-11-06: a `past` moment is a date's records, not a filter over the snapshot, and home's script runs `roomClock` alone (ADR 0044).

## Context

The room's picture told stories nothing had measured. `scene.py` painted six invented notes on the corkboard, a seeded random grid on the framed screen, three rows of seeded books, and a tonearm resting on the record at all times, so the scene said "playing" even when nothing was. The owner asked for the objects to show real data. The decisions about what the room says also lived in four places: `tick()` in `room.ts`, `now-playing.ts`, a CSS rule for the cat's hours, and `roomFacts` in the terminal view.

## Decision

**One pure model.** `roomState(inputs, moment)` in `src/lib/room-state.ts` returns a complete `RoomState`: sample flag, window, lamp, shelf, pins, screen and record. It holds no state, reads no clock and touches no DOM. The build, the browser and the terminal Worker all render its result, and the same arguments always give the same state. A renderer that keeps part of an earlier drawing would make the DOM a second model, so "do not update" is not a value of the state. `changedParts` is the render diff: the page redraws only what differs from what it shows.

**The inputs are complete and live outside the function.** The build writes a `RoomSeed` (`src/lib/room-seed.ts`): posts, every event of the newest six pins and the newest code event, twelve weeks of `{date, totalTokens}` back from the date usage was observed, the source's month-to-date tokens, and the listening fields the line needs. Trimming must not change what the room says: seeded and whole-snapshot states are held equal. It goes to the browser as `data-room-seed` on `.scene` and to the Worker in `/terminal/room.json`. Each renderer merges its answers into that set and calls `roomState`. Null means unknown; a reading of nothing means a known empty; each reading carries its origin (`live`, `build`, `sample`), so a page keeps its sample mark whatever arrives later. Costs never enter: the seed names its fields, so `costUsd` cannot reach the HTML, the JSON or the state (ADR 0014).

**Three kinds of moment.**

| Kind    | What it is                                   | Window, lamp      | Record                                | Dated events, scrobbles | Daily totals                                                           | Weather                   |
| ------- | -------------------------------------------- | ----------------- | ------------------------------------- | ----------------------- | ---------------------------------------------------------------------- | ------------------------- |
| `live`  | This instant, with a clock                   | From the clock    | May say playing                       | As observed             | Up to the observation's date, with an as-of while that day was running | `readWeather` on the body |
| `built` | The build, whose page must hold while served | Null: no-JS scene | Rests, `Last played`                  | As observed             | The same                                                               | None                      |
| `past`  | A date already over (ADR 0044)               | From the clock    | Never playing; from the date's record | That date's records     | That date's records, as a day summary                                  | The date's night slot     |

A snapshot taken at 18:00 holds all of that day's tokens, so filtering by date cannot make a 09:00 claim. ADR 0044 settled this by claiming no instant: a past moment says what its date came to, from `/v1/days`.

**The refresh outcome is separate from the accepted answer.** `follow` in `live.ts` is the DOM-free reader `live()` now uses: it keeps the accepted answer and reports whether the latest refresh brought it. A reading then carries `currentUntil`: the last instant it may be said to describe now, or null. An older, stale, null or malformed answer leaves a young accepted snapshot in place and still stops the record, as the panel always did. The exact 15-minute limit stays: `roomState` checks `instant <= currentUntil` on every tick. The panel's line and the scene's record are one `RoomState.record`; `renderNowPlaying` takes a line and decides nothing.

**The objects.**

| Object        | Source                                  | Freshness                | Empty                   | Unknown        |
| ------------- | --------------------------------------- | ------------------------ | ----------------------- | -------------- |
| Corkboard     | Shipping events at build                | Per build, words dated   | Bare cork               | Bare cork      |
| Framed screen | `/v1/llm-usage` days at build           | Per build, words dated   | Dark, no words          | Dark, no words |
| Bottom shelf  | `getPosts()`, the list /writing renders | Per deploy               | Bookend, `No posts yet` | Never          |
| Record        | `/v1/listening`, live                   | Each minute, 15 min rule | Rests, arm parked       | Rests          |

- **Pins.** A pin is one repository on one UTC day, by the biggest thing that happened there (release, merge, push), so 44 merges in a day take one note. A release is the larger amber note, and up to three ink lines count the events. Stars and empty pushes are not shipping. Six newest.
- **Screen.** Eleven weeks, a column each from Monday, through `heatmap` and `heatLevels`, the drawing and levels /stats uses. It ends on the date it observed: a day after that is unknown, never zero. The grid is dark in both themes through `color-scheme: dark`, so the one amber ramp resolves to its night values.
- **The screen is build-only.** The live version needs a full-year fetch on every cold home visit, phones included, where the frame is outside the crop. It was not measured under throttling, so it does not ship. Its words are the source's own month-to-date total, `61.3M tokens, 1–26 Oct, as of 26 Oct, 09:00`, which stays true however long the page is served. Where the source gave no such figure, as for a past moment, a sum of the days held claims the period only if it holds every day; otherwise it says `2.0M tokens on record, 1–25 Oct`, so a missing day never reads as zero. Going live later is a matter of a reader and a line in `draw`.
- **Shelf.** The top two rows are what the owner reads (decoration, later trellis, ADR 0013). The bottom row is what the owner wrote, one spine per post in 19 tracks, oldest first, tone fixed by the post's place in the list, so a new post moves nothing. Past 19 it shows the newest 19 and counts them all. A post dated after the moment waits.
- **Spines are decoration.** Fifteen pixels wide at best, a link there would fail WCAG 2.5.8 with no equivalent on the page. So no links, no tab stops, and `aria-hidden`. Their count and newest title are in the Notebook's name: `Notebook: writing. 3 posts, newest: Token logs.`
- **Record.** The base art parks the arm. `record-{night,day}.png` are eight-frame strips holding only the pixels that differ, 0.5 KiB each, loaded only when `data-record="playing"`. The first frame has the arm on the disc, so reduced motion loses the turning and not the fact. Dusk and night use the night strip in either theme.
- **Hotspots.** Each says its fact after `Object: section`, from `hotspotWords` in `room.ts`. A record line that no longer describes now keeps its date: `Nothing played lately · checked 26 Oct, 09:00`. `nowPlayingWords` is the one plain wording, for the hotspot and the terminal. Layers are `aria-hidden`, so the fact is said once. No new live region: the Listening line stays the one that announces. Forced colours keep the layers as picture, as the words are in the links.

**The base art is bare.** Bare cork, a dark frame, an empty bottom shelf with one brass bookend, a parked arm. No-JS gets the objects from the HTML. The og cards (ADR 0027) use the base PNG and so show the bare room. That is honest and accepted: the bare room invents nothing, and a card cannot carry the layers.

**Merged where this touched them.** `plural` (`plural.ts`), `dayMs`, `tokens`, `dateRange`, `repoName`, `utcDay` (`words.ts`), `skewMs` (`live.ts`), `heatmap` (`heat.ts`), one `knowsRabat` (`rabat-date.ts`); the time with a date is now `rabatStamp`, so `rabatTime` means one thing; the cat's words live in `room.ts`, and its hours in `isCatHour`, not CSS (`data-cat` replaces `data-hour`).

**The room's script runs on `poll`.** It asks for weather as every live panel asks: every 15 minutes, and on return once its last request is a minute old. A failed request passes no weather, keeping ADR 0029's rule. Back/forward restores now redraw too. A tab that keeps coming back can reach one request a minute, not the four an hour ADR 0029 states.

## Measured

Built import graph, `gzip -9` on each file, summed: a page's entry script and the chunks it imports.

| Page   | Before  | After   | Change   |
| ------ | ------- | ------- | -------- |
| Home   | 5,247 B | 7,933 B | +2,686 B |
| /stats | 9,258 B | 9,609 B | +351 B   |
| /uses  | 3,445 B | 3,469 B | +24 B    |

As `scripts/budgets.ts` measures it, home's script is 3,980 B under a cap of 4,350 B, set at 10 % over the first measurement. ADR 0029 asked for a decision before passing 2,300 B; the owner asked for this feature. The now-playing entry is gone. Part of home's cost is the shelf, pin and screen code, which runs in the browser only so the state stays complete there, and which ADR 0044's scrub draws. Home's HTML grows by 1,422 B gzip, mostly the seed. The base PNGs lose 768 to 985 B each. The screen's live version was never measured, as it does not ship.

Rollup names a shared chunk after its first module, so the live reads chunk is now `plural.*.js` (1,886 B, cap 1,900 B) and the listening reads chunk `heat.*.js` (1,991 B, cap 2,010 B), which also holds `words.ts` and the heat levels. Their caps moved with what they hold, and `budgets.ts` fails loudly when a name changes. /now stays off these chunks: `staleFrom` steps the calendar, so that page imports no `dayMs`.

## Consequences

- Every fact in the room has one home, and a new renderer needs no decisions of its own.
- The shelf is empty in production until the first post, which is the true state.
- ADR 0044 can scrub with `kind: 'past'` and needs a reader for `/v1/days` and storage for listening and weather. Every day without that storage is lost.
- The corkboard and the screen age between deploys. Their words say so by carrying their dates.
- `moonDisc` and the object rectangles in `room.css` still repeat positions from `scene.py` by hand, as two languages have to.
