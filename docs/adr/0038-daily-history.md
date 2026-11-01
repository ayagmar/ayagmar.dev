# 0038. Daily history

Status: accepted, 2026-11-01. Amends ADR 0009 (a seventh adapter), ADR 0010 (a table, a route, budgets), ADR 0014 (llm-usage days are also kept in history) and ADR 0034 (the shipping strip's data).

## Context

The shipping strip on the home page and /stats drew 28 days from the shipping snapshot's 50 newest events. On 1 November those reached back only to 30 October (44 merges on the 31st), so 25 of the 28 squares were empty while the caption said "5 Oct to 1 Nov". signals keeps only the latest snapshot per source, so nothing older survived.

repo-pulse now serves `GET /public/activity?days=N` (ayagmar/repo-pulse#38): public activity summed per UTC day, with a per-repository breakdown. signals should keep such days for good, as the base for a later `/day/<date>` page and per-post or per-repository receipts. This decision wires the shipping activity and the llm-usage push's days; other sources can join the same table later.

## Decision

### The table

`apps/signals/migrations/0004_daily.sql` adds `daily (source, day, json, fetched_at, updated_at)`, `STRICT, WITHOUT ROWID`, primary key `(source, day)`. Rows are inserted or replaced, never deleted. It is a new table only: nothing on `snapshots`, `push_deliveries` or `pull_progress` changes, and the Worker version before it runs unchanged against it.

A series' days are in its own zone, given by `dailyZones` in `packages/contracts/src/days.ts`: `shipping-activity` counts UTC days (repo-pulse's), `llm-usage` counts days in Africa/Casablanca (ADR 0014). A Rabat day cannot be turned into a UTC day from daily totals, so neither is converted. A later `/day/<date>` page shows each series under its own date with its zone named.

### Writers

**`shipping-activity`** is a source of its own (`sources.ts`, stale after 6 hours) with a pull adapter, `apps/signals/src/adapters/pull/shipping-activity.ts`, rather than a part of `shipping`: as its own source its failures show in `/v1/health` (until repo-pulse deploys the route, `upstream_not_found`), and an activity outage cannot blank the shipping list. Hourly, it asks for `days=400`, body capped at 512 KiB. The answer (schema `repo-pulse-activity.input.json`) is all or nothing, since what it writes is kept for good:
- `complete: false` (repo-pulse's visibility gate left a repository unresolved and the counts may be short) is `upstream_incomplete`: nothing stored, the next run tries again.
- It must be exactly the 400 days, one per date, oldest first, ending on the UTC date of `generatedAt`; each day's repositories sorted and listed once; each day's counts the sums of its repositories', or at least that when `reposTruncated`. Anything else, a bad field included, is `upstream_malformed`. A `generatedAt` more than 5 minutes ahead of the Worker's clock is too.
- 404, 429, 503 and other statuses fail as the feed's do (ADR 0009, ADR 0012).
- Days before `since` (when repo-pulse began recording) are left out, never stored as zeros. `since: null` is a success that writes nothing.

The snapshot it keeps is small: `since` and the repositories the answer named on any day. Its `fetched_at` is repo-pulse's `generatedAt`, which orders answers. The snapshot upsert takes an answer only if the stored one is older; the days are written in the same D1 batch, only if the snapshot row now carries this answer's `generatedAt`; a third statement records the attempt either way. So a slow or overlapping pull whose answer is older than the stored one is a successful pull that changes nothing, and every answer that reaches `daily` is at least as new as every earlier one.

The adapter avoids the first 15 minutes of a date in Rabat (`dueAt`), which belong to the listening history (ADR 0030); its worst case at midnight stays at 10 minutes 2.3 seconds.

**`llm-usage`** keeps the push as it is. `admitPush` adds a third statement to its batch that reads the days from the snapshot just stored, not from the request, and runs only when `snapshots.last_delivery_id` is this delivery and `push_deliveries` records this producer, delivery id and body hash. A retry, a reused id with another body, a too-soon or an older push writes no day. Once the series has any row, only the push's newest 35 days are written; the first accepted push writes all of its days (up to 371).

### What wins for a day

Every write to an existing day needs all three: the report is at least as new as the row (`fetched_at`), its values differ, and the day is at least as large: for shipping, pushes + commits + merges + releases + stars; for llm-usage, `totalTokens`. Ties replace, so a repriced cost or a newly reported `activeMs` lands.

A day only grows because a smaller count for a past day means data was lost or left out, not that less happened: repo-pulse can answer short when its gate is cold (now refused by `complete`), a repository turned private drops out of repo-pulse's counts, and llm-usage-metrics reads agent logs that some agents delete after a month. A private repository's counts therefore stay in a day's totals; its name does not (below).

### Read route

`GET /v1/days/<series>?month=YYYY-MM` or `?last=28`, series `shipping-activity` or `llm-usage`. A month runs from 2025-01 to the current month in the series' zone; `last=28` is the 28 days ending today there. Anything else is `400 {"error":"invalid_query"}`; another series is the JSON 404. Only these blocks exist, so each is one edge cache entry, cached as the snapshot routes are (ADR 0010).

The answer is a contract envelope (`days-shipping-activity.output.json`, `days-llm-usage.output.json`, frozen in `test/frozen/v1/`) with `fetchedAt` and `stale` from the source's snapshot, and `data` null until the source has succeeded once, else `{ zone, from, to, days }`: the days with a record, oldest first, one per date. A date in the block without an entry was not recorded. Sorting and uniqueness are guarantees of the route, tested there, not of the JSON Schema.

A shipping day lists only repositories that are the owner's and are named in the latest activity answer (repo-pulse names public repositories only) or are featured projects. Another repository's counts stay in the day and its name is left out, and `reposComplete` is false, as it is when repo-pulse listed only the 50 busiest. A repository made private disappears from every day at the next pull, however old the day.

### The strip

The home page and /stats draw the strip once, at build, from `/v1/days/shipping-activity?last=28` (`shippingStrip` in `apps/site/src/data/format.ts`, `ShippingHeat.astro`). A square counts the day's pushes, merges and releases; stars are attention, not shipping. Days without a record are drawn as an outline, at least 3:1 against the strip (`e2e/contrast.spec.ts`), and the caption names the first and last day with a record and, when some are outlined, says so. Under it: "Counted up to 26 Oct, 08:55 UTC", the history's `fetchedAt`, since the list's live freshness line belongs to another source and the strip is never redrawn in the browser.

Without the route, or with no recorded day in the 28, the strip falls back to the events of the shipping snapshot, over the days from the oldest event's to the snapshot's own (UTC), ending on the build's day, and counted up to the snapshot's `fetchedAt`. Previews draw the fixture (ADR 0015), where recording begins on 12 October and 13 days are outlined.

### Budgets against Workers Free

| Resource         | Use                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1 rows written  | Activity: only days whose values change, at most 400 an hour, so at most 9,600 a day; usually today's and yesterday's. llm-usage: at most 35 per accepted push and one accepted push a minute, so at most 50,400 a day (371 once). With the snapshots and deliveries of three producers at the 60 s ceiling (21,600) and listening (about 3,000), the worst case is about 85,000 of 100,000. |
| D1 rows read     | A block read is at most 31 day rows plus the status row. Even uncached (Preview URLs have no edge cache), 100,000 requests a day would read 3.2 million rows, under 5 million with the cron's 13,000.                                                                                                                                                                                        |
| Subrequests      | 1 per activity pull.                                                                                                                                                                                                                                                                                                                                                                         |
| CPU per cron run | Measured with `just signals-cpu` in local workerd, over the no-adapter baseline: 3.7 ms warm and 6.8 ms cold with all 400 days new and 3 repositories a day; 3.0 ms warm when nothing changed; 10.6 ms warm with 12 repositories on every day, near the body cap. Local D1 runs in the measured process; in production it does not. Listening measured 2.5 ms warm on the same run.          |
| Storage          | Two series, one row a day each, a few hundred bytes a row: well under 1 MB a year.                                                                                                                                                                                                                                                                                                           |

zod without its compiled fast path, as in workerd, took 3 to 4 ms warm and about 8 ms cold to parse a 400-day answer in Node, so the adapter checks the days with a hand-written reader (`readActivityDay`) and zod only the rest; `test/pull-normalize.test.ts` holds the reader to `repoPulseActivityDaySchema` on every fixture day and on cases at each check's edge.

## Consequences

- The strip shows only days signals has recorded. On the first builds after this ships, most of the 28 are outlined: repo-pulse began recording in late October 2026 and cannot seed older days.
- History is as good as repo-pulse's `complete` flag and visibility gate: a day stored from a complete answer is never lowered later.
- The rollout has an order (docs/operations.md): migrate, deploy signals, check the route has days, then rebuild the site. A site built before the route answers keeps the event fallback until its next build.
- Rows are never deleted. Removing a series, or a day, is a migration or a manual D1 statement.
