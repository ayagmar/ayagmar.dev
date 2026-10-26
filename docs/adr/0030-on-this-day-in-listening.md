# 0030. On this day in listening

Status: accepted, 2026-10-26

## Context

The owner asked for "On this day" on `/stats`, next to the listening section: for each past year with scrobbles on today's date in Rabat, the year, how many scrobbles that day, and the most played track and its artist. Years with none are left out; with none at all, one plain line says so.

Two rules shape the rest. The page must never show another day's history as today's: not from a build made yesterday, a cached answer, a pull that ran across midnight, or a visitor whose own time zone is on another date. And the upstream use must be bounded and stated: Last.fm, the Workers Free cron (10 ms of CPU and 50 subrequests per invocation, ADR 0009), and D1.

The owner dropped the Last.fm permission question on 2026-10-26: no approval gate, no "powered by AudioScrobbler" credit and no ADR 0022 licence change for Last.fm data.

## Decision

### Today's date in Rabat

Every date here is a calendar date in `Africa/Casablanca`, from the runtime's tzdata through `Intl`, never a fixed offset. `packages/contracts/src/rabat.ts` is the one definition, shared by signals and the `/stats` script (it has no zod, so the browser can load it):
- `rabatDate(time)` is the date there at a Unix time.
- A day is the set of instants with that local date: from `rabatDayStart(date)`, the first second whose date is `date`, to `rabatDayStart` of the next date. Both ends are found on their own, by a binary search within three hours of midnight UTC (Rabat has been at +00 or +01 since 1913), so a day can be 23 or 25 hours long and can start at 01:00. The search assumes the date never steps back, which holds for all 72 Africa/Casablanca transitions since 1913 in tzdata 2026e: each fall-back near midnight repeats 23:00 of the same date, and each spring-forward skips 23:59:59 to 01:00.
- `apps/signals/test/listening-history.test.ts` checks the bounds against `zdump -v -c 2008,2027 Africa/Casablanca` (tzcode and tzdata 2026e), quoted in the test: 2008-06-01 starting at 01:00 (no midnight), 2008-08-31 lasting 25 hours (23:00 twice), the 2025 Ramadan changes on 23 February and 6 April, and the move to +00 for good on 2026-09-20. It also tests requests at a day's start − 1, start, end − 1 and end.
- 29 February is asked for only in leap years (`calendarDatePattern`, the full Gregorian rule, checked for every date from 1900 to 2100), and on 28 February a leap year's day ends where the 29th starts, so the 29th's scrobbles are never counted.

### signals: the `listening-history` source

A source of its own, apart from `listening`: its own snapshot, interval, failures and staleness. `apps/signals/src/adapters/pull/listening-history.ts`, following ADR 0009:
- **Requests.** `user.getInfo` for min7_'s registration time, then for each past year from the registration year to last year, `user.getRecentTracks` with `limit=200`, `page=1`, and `from` and `to` as that year's day bounds. Each is a POST with the key in the form, as for listening, so the key is never in a URL that Workers traces record. On 2026-10-26 Last.fm's `from` was inclusive and `to` exclusive (`from=T&to=T` returned nothing; `from=T&to=T+1` returned the scrobble at T), pages come newest first, and an empty range answers `{"track":[],"@attr":{…,"total":"0"}}`. Body caps: 16 KiB for `user.getInfo`, 384 KiB per page (scrobbles came to about 720 B each on 2026-10-26, so about 140 KiB for a full page).
- **Registration.** The year comes from `user.registered.unixtime`, converted to Rabat, never the display text. Missing, unreadable, before 2002 or after today is `upstream_malformed`: a failure, never an empty history. Registered this year means no past year to ask about and an empty list. More than 24 past years is `over_budget`.
- **A day's page.** Its own wire schema (`lastfmHistoryPageSchema`), not listening's: at most 201 items (200 and a now-playing track). The page must be page 1 of min7_'s, `perPage` 200 and `totalPages` agreeing with `total`; it must hold exactly `min(total, 200)` dated scrobbles, each inside the day asked for and newest first, with a non-empty artist and title after trimming spaces at either end. Anything else fails the pull with `upstream_malformed`, since skipping a scrobble would change a count. The now-playing track is left out. Error bodies with HTTP 200 are read as for listening: 29 is `upstream_rate_limited`, 6 `upstream_not_found`, others `upstream_error`.
- **Counting.** `scrobbles` is Last.fm's `total` for the day. A track is its exact artist and title after the trim, counted in nested `Map`s so no name can collide with another or with an object key. The top track has the most plays; a tie goes to the one scrobbled first that day, then to artist and then title in Unicode code point order, so the result does not depend on locale. With more than 200 scrobbles only the newest 200 are read: `read` says how many, and the top is only the top of those. The snapshot keeps `scrobbles`, `read` and `top` apart, and the site says when `read` is smaller.
- **The snapshot** (`listeningHistorySnapshotSchema`): `describedDate` (`YYYY-MM-DD`, the Rabat date it is for, a real calendar date), `firstYear` (registration year in Rabat), and `years`, newest first, at most 24, only years with scrobbles, each `{ year, scrobbles, read, top: { track, artist, plays } }`, titles and artists 1 to 1,024 characters. No artwork, album, MBID, URL or profile field. `staleAfterSeconds['listening-history']` is 24 hours; a snapshot for another date is wrong however fresh, and the site rejects it on its own (below). The largest snapshot the schema allows is under 300 KB even with every character JSON-escaped, far under D1's 2 MB row limit.
- `GET /v1/listening-history` is `snapshotRoute('listening-history')`: the envelope, `stale`, at most 60 seconds of edge and browser cache, HEAD, OPTIONS and CORS as for every source.

### One year per cron invocation

A whole pull in one invocation measured 11 ms of CPU warm and 22 ms cold locally for this account's three years, and 48 ms for 24 years, so the pull is spread over invocations of the same Rabat date and published only when every year is read:
- The first invocation of a pull captures `describedDate` once, asks for the registration and reads the newest year; each later one reads one more year. What has been read is kept in D1 (`pull_progress`, migration `0002`), not in memory, so a restarted isolate carries on. A save names the step it read, so of two overlapping invocations only one adds its year.
- Until the last year, the invocation fails with `in_progress`: the runner records it as an attempt (logged at `log` level, not as a warning), and the stored snapshot, `fetched_at` and `last_success_at` stay as they were. The last invocation clears the progress and returns the whole snapshot, written in one statement.
- All or nothing: a failure at any year, or in the registration, publishes nothing. The progress stays, so the next try resumes at the failed year.
- A pull keeps its `describedDate`. One that is still running at midnight in Rabat, or would end within 5 seconds of it, fails with `date_changed` and is not published, so yesterday's answers are never labelled with today's date and a write after midnight cannot make the new date look done. Progress saved for another date is ignored, and the new date's pull starts over.
- A stored snapshot that names its `describedDate` is never replaced by one for an earlier date (the condition is in `D1SnapshotStore.put`), so a slow write from before midnight cannot undo the new date's.

Each invocation makes at most 2 subrequests (registration and one page, or one page), well under 50, and a pull makes 1 + one per past year: 4 for this account today, 25 at most. The two requests are sequential, each with getJson's 5-second timeout, so they fit the runner's 20-second deadline with room to spare, and its signal aborts them.

### When it runs

The runner is unchanged in kind: one adapter per invocation, the most overdue. It now asks an adapter when it is due (`PullAdapter.dueAt`), and this one answers by date:
- **New date in Rabat**, with the last snapshot for an earlier one: due since its last attempt, so the first trigger of the date runs it ahead of sources only just due, even if the last attempt was minutes ago. The same after a success that published an earlier date's snapshot: if D1 holds the last write of yesterday's pull past midnight, its `fetched_at` is today but its `describedDate` is not, and the new date's pull starts at the next trigger (`test/listening-history.test.ts` delays that write by 7 seconds).
- **Pull in progress** on today's date: due 30 seconds after the last part.
- **Today's snapshot stored**, by its `describedDate` (the runner's status list reads it from the stored JSON), never by when it was written: due 7 hours after the last attempt, so at most four successful pulls a Rabat day (about 00:00, 07:00, 14:00, 21:00).
- **Failed with no snapshot for today**: due 5 minutes later, then at half the time since midnight, at most an hour later: 31 tries on a day that fails throughout. A refusal (HTTP 429 or error 29) waits like any failure, and no other key or address is tried; there is no retry inside an invocation.
- **Refused with `Retry-After`**: not before the time it names, whatever the rules above say, the new date's included, and with no early allowance. `getJson` reads the header with the body (`retryAfter` in `http.ts`): delay-seconds or an IMF-fixdate HTTP date, capped at a day ahead; anything else, or a time already past, is ignored and the backoff above applies. The refusal's `PullError` carries the time, and the runner keeps it in `snapshots.retry_after_at` (migration `0003`, a nullable column), so a restarted isolate honours it too; the next success clears it. Last.fm sent no `Retry-After` on 2026-10-26; the tests send both forms. The runner honours it for any adapter whose refusal carries one, listening and weather included.

`apps/signals/test/cron.test.ts` runs two days of minute triggers with all five sources across the midnights of 19 September 2026 (+01, 23:00 UTC) and 21 September 2026 (+00, after the change on the 20th), keeping every earlier source's start, gap and end-of-window assertions (listening at most 5 minutes apart, the others within their interval and 5 minutes). It checks that each new date has its history within 10 minutes when Last.fm answers, within 15 when the first attempt of the date fails, and at most four times a day. A second test seeds the worst case: every source due exactly at midnight, the history's last attempt at 23:58 (a success, or a failure), and the triggers at 00:02 and 00:03 lost, in both offsets. For this account's three past years the history was published 9 minutes 2 seconds after midnight in every case, and 7 minutes 2 seconds with no lost triggers. Each further past year adds about 2 minutes, since the history alternates with listening's minute pulls, so the 10-minute target holds up to about four past years with this contention and not beyond; the account has four from 1 January 2027. Add up to 60 seconds of edge cache, and for a page left open across midnight, up to 5 minutes until its next request. This is not an outage guarantee: with Last.fm down, the history stays hidden.

### Cost

CPU per cron invocation, measured with `just signals-cpu` (`scripts/signals-cpu.ts`): a bench Worker runs one real invocation in `wrangler dev`, D1 included and Last.fm answered from memory with pages as large as real ones (about 720 B per scrobble), and the CPU time Linux charged to the workerd process is read around it, cold (first call in a fresh isolate) and as the median of ten warm calls, less the same measure for an invocation with no adapter due (cold 7.0 ms, warm 3.8 ms; listening's row is from an earlier run of the same bench, against 7.1 and 4.3). Cold numbers move by a few milliseconds between runs. Working out every past year's day bounds in each invocation cost about 5 ms for 24 years, so an invocation works out only the year it reads. DevTools profiles were tried and dropped: local workerd does not mark idle time, so waits show up as JavaScript. Local D1 runs in that process, so its queries count here and do not in production.

| Invocation, over the no-adapter baseline                    | Cold    | Warm median (max) |
| ----------------------------------------------------------- | ------- | ----------------- |
| listening (for comparison)                                  | 8.9 ms  | 2.0 ms (3.1)      |
| History, first: registration and a 100-scrobble page        | 16.1 ms | 5.9 ms (8.4)      |
| History, middle: one full page of 200                       | 15.1 ms | 5.8 ms (8.4)      |
| History, last of 24: a full page, then the largest snapshot | 8.7 ms  | 5.3 ms (6.2)      |

Production numbers differ: the orchestrator's Workers Logs reading on 2026-10-26 had listening at 12 ms p50 and 27 ms max, and shipping at 25 ms p50, already over the 10 ms Free limit. By the local ratio a history invocation should land at roughly two to three times listening's warm cost. Profile it in Workers Logs after the first deploy, with the work on the other adapters.

| What                        | Use                                                                                                                                                                    |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Last.fm requests            | 1 + one per past year per pull, at most 4 pulls a day: 16 a day now, at most 100; a failing day adds up to 62                                                          |
| Last.fm request rate        | At most 2 per invocation, one invocation a minute; listening's 4 run in other invocations                                                                              |
| Subrequests per invocation  | At most 2 of 50                                                                                                                                                        |
| D1 writes                   | Per part a progress row and the attempt on the snapshot row; per pull one snapshot write and one delete: 24 rows a day now, at most about 200, plus one per failed try |
| D1 reads                    | One progress row per part, besides the runner's list of 7 rows a minute                                                                                                |
| D1 storage                  | One snapshot row and at most one progress row, each under 300 KB                                                                                                       |
| Browser requests to signals | Per visible `/stats` tab: on load, then every 5 minutes while there is nothing for today, hourly once there is                                                         |

### The site: `/stats`, in the browser only

The build never reads the history, so a page built yesterday cannot show it. `stats.astro` puts a block at the end of the listening panel, `hidden` in the HTML: without JavaScript, in `fixtures` mode (local, CI, Previews: no endpoint attribute, no request), or in a browser that cannot work out the date in Rabat, it stays hidden. In `api` mode it carries `data-history-src="${SIGNALS_API_BASE}/v1/listening-history"`, and `src/scripts/history.ts`, the page's only script of its own:
- Asks on load when the page is visible, then on a minute tick when due: every 5 minutes while there is nothing for today to show, hourly once there is. One request at a time, `AbortSignal.timeout(5000)`; an error status, a failure or the deadline drops the history, as the room's weather does (ADR 0029).
- Shows an answer only through `readHistory` (`src/lib/history.ts`): `source` `listening-history`, `version` 1, `stale` false, a readable `fetchedAt`, every value of its type and in the contract's range, and `describedDate` equal to today's date in Rabat by the browser's own tzdata, at the moment it checks. `test/history.test.ts` checks that `readHistory` and the contract agree on the whole corpus and every snapshot fixture.
- Checks again at the start of the next date in Rabat (a timer set to that instant), on every minute tick, and on `visibilitychange`, `focus` and `pageshow`, so a tab that slept or came back from the back/forward cache hides yesterday's history at once.
- Fails closed: the date comes from `Intl` with `timeZone: 'Africa/Casablanca'`, which throws in a browser without the zone; and a browser whose tzdata predates Morocco's 2026 change (still +01) would be an hour early at midnight, so the script makes no request there. Visitors in Auckland and Los Angeles see Rabat's date, not theirs.
- Renders with `textContent` only, titles in `<cite>`: Last.fm's names are never markup. No artwork, no request to Last.fm.

Words: "On 26 October in past years:", then one line per year, "2025: 29 scrobbles. Most played: Nowhere to Run by LTN, 2 times."; for a partly read day, "Most played of the 200 read: …"; with no past year, "Nothing played on this date in any past year." The page caption says the block is fetched by the browser and shown only on that date in Rabat.

The script is 1,435 B gzip and has its own allowance in `budgets.json`, 1,500 B, matching one file loaded only by `/stats` (ADR 0017). It imports `rabat.ts` and `history.ts` and nothing the home page's room script uses, so no chunk is shared and the home page's JavaScript is unchanged. The e2e tests measure no layout shift as it fills in at 320, 360 and 1280 px.

### Contracts and fixtures

`listening-history` joins `sourceIds` and the generic envelope's enum; its envelope is exported as `schema/listening-history.{input,output}.json`, with its corpus, and frozen as `test/frozen/v1/listening-history.output.json` (ADR 0008). Every earlier frozen v1 schema is byte for byte unchanged. Raw fixtures are a separate dataset, `lastfm-history`, one file per case holding the whole pull's answers; snapshot fixtures cover each case that succeeds. The MSW handlers answer only the exact requests a case expects (method, user, range, page 1, limit 200) and fail any other or a repeated one. The `ok` case is the real set of requests made on 2026-10-26 at 16:31 UTC, approved by the owner and cut to each scrobble's artist, title and time and the registration time; the live capture was a manual step, not part of any test.

## What it falls back to

| Case                                                                  | `/stats` shows                                                                    |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| No JavaScript, `fixtures` mode, or a browser without current tzdata   | No block                                                                          |
| Before the first answer, failed request, error status, timeout at 5 s | No block                                                                          |
| `stale: true`, invalid envelope or value                              | No block                                                                          |
| Snapshot for another date than today in Rabat                         | No block, until a snapshot for today arrives                                      |
| Midnight in Rabat while the page is open                              | The block goes at midnight; today's comes within minutes of signals publishing it |
| Last.fm failing                                                       | signals keeps the last snapshot; the page hides it once its date has passed       |
| No past year with scrobbles                                           | One line saying so                                                                |
| More than 200 scrobbles on a day                                      | Last.fm's count, and the top "of the 200 read"                                    |

## Consequences

- The history needs signals to have pulled today's date: a Last.fm outage across midnight leaves the block hidden all day, by design.
- The time to today's history grows by about two minutes per past year, past the 10-minute target from four years on under worst-case contention. Keeping it under 10 minutes for older accounts needs another design, such as a second cron trigger for the history, which is the owner's call.
- Listening skips a minute now and then while a history pull runs; its gap stays within 5 minutes.
- If Morocco changes its clocks again, `knowsRabatDate` in `src/lib/history.ts` and `knowsRabatTime` in `src/lib/sky.ts` move with the new rules.
- A history invocation's CPU in production is not measured yet; check it in Workers Logs after the first deploy.
