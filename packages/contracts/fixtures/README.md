# Fixtures

One shared fixture set for every test and for the site's offline `fixtures` data mode.

```
fixtures/<upstream>/raw/<case>.json                  what a pull adapter's `fetch` returns for that upstream
fixtures/<source>/snapshot/<case>.json               normalized snapshot the adapter (or the push projection) must produce
fixtures/<producer>/push/{accept,reject}/<case>.json push bodies (llm-usage, trellis)
```

Raw fixtures are per upstream (`lastfm`, `lastfm-history`, `repo-pulse`, `github`, `npm`, `open-meteo`); snapshots are per source id from `src/sources.ts` (`listening`, `shipping`, `projects`, `llm-usage`, `shelf`, `weather`, `listening-history`). The `projects` source is built from `github` and `npm` together: case `<case>` of the snapshot comes from case `<case>` of both. Every raw, snapshot and push file is imported in `src/fixtures.ts`, which `test/fixtures.test.ts` checks.

Push bodies are the payload corpus of `push-<producer>` (checked by zod and the exported JSON Schema in `test/json-schema.test.ts`) and the inputs of the Worker's intake tests. `fixtures/llm-usage/snapshot/` and `fixtures/shelf/snapshot/` hold what signals publishes for the accepted push cases of the same name.

| Push case          | Meaning                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------ |
| `ok`               | A full, typical push.                                                                                  |
| `minimal`          | Empty lists and null costs.                                                                            |
| `sensitive-fields` | Valid, with unknown and sensitive extra fields and unlisted ids; none of them may be stored or served. |
| `reject/*`         | Wrong types, ranges or shape; every validator must reject them.                                        |

The oversized case is built by the intake test (a valid body padded to 64 KiB and one byte more) rather than kept as a 64 KiB file.

A raw fixture records each upstream answer as `{ "status": <HTTP status>, "body": <JSON body or null> }`; `null` in place of an answer is a request that failed (network error, timeout, body over the size limit). Last.fm and GitHub need several requests per snapshot, so their raw fixtures are an object of such answers, keyed by request (`recentTracks`, `topArtists`, `thisWeek`, `lastWeek`) or by repository and package.

| Case           | Meaning                                                                             |
| -------------- | ----------------------------------------------------------------------------------- |
| `ok`           | A full, typical response.                                                           |
| `empty`        | Valid but with no items (new account, quiet week, every repository gone).           |
| `partial`      | Optional fields missing or null, and some requests failing on their own.            |
| `malformed`    | Wrong types or broken shape; the adapter throws a `PullError`, never anything else. |
| `missing`      | The upstream returned nothing usable (404, refused); only `raw/` exists.            |
| `single-item`  | Last.fm only: a list of one returned as a bare object.                              |
| `error-in-200` | Last.fm only: an error body sent with HTTP 200.                                     |

Open-Meteo answers one request with scalar values, not a list, so its cases read differently (ADR 0029):

| Case                                    | Meaning                                                                                                |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `ok`                                    | Real: Rabat, 2026-10-26 13:30 UTC, overcast.                                                           |
| `clear`, `fog`, `rain`, `snow`, `storm` | One weather code of each picture the home page draws.                                                  |
| `unknown-code`                          | A whole-number code Open-Meteo does not document: served, and the site shows no weather for it.        |
| `partial`                               | Values the model has none for, null or left out: null in the snapshot, never 0.                        |
| `empty`                                 | No current conditions (a null weather code): the pull fails with `upstream_error`; only `raw/` exists. |
| `malformed`                             | A changed unit and the code as a string: `upstream_malformed`.                                         |
| `missing`                               | Refused with HTTP 429: `upstream_rate_limited`.                                                        |

The history behind "On this day" (`lastfm-history`, ADR 0030) is one pull per Rabat date: `user.getInfo` for the registration time, then page 1 of `user.getRecentTracks` for the same date in each past year. Its raw fixture is `{ "describedDate", "registration": <answer>, "days": [{ "year", "from", "to", "page": <answer> }] }`, newest year first, with `from` and `to` the Unix seconds the date began and ended in Rabat that year. The MSW handlers answer only those exact requests.

| Case                   | Meaning                                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------------------- |
| `ok`                   | Real: 2026-10-26, with 99, 47 and 29 scrobbles in 2023, 2024 and 2025.                                   |
| `empty`                | No scrobbles on the date in any past year: an empty list, which the site shows as one plain line.        |
| `new-account`          | Registered this year: no past year to ask about, and no request after `user.getInfo`.                    |
| `single-item`          | A day of one scrobble, sent as a bare object.                                                            |
| `now-playing`          | A now-playing track first in the list; it has no date and is not counted.                                |
| `leap-day`             | 2028-02-29: only 2024 has the date; 2025 to 2027 are not asked for.                                      |
| `feb-28`               | 2027-02-28: 2024's day ends where 29 February starts; the 29th's scrobbles are never asked for.          |
| `ties`                 | Tracks tied on plays: the earliest first scrobble wins, then artist and title by code point.             |
| `approximate`          | 450 scrobbles, 200 read: the count is Last.fm's total and the top track is marked as among the 200 read. |
| `error-in-200`         | Error 29 with HTTP 200 for one year: `upstream_rate_limited`, nothing published.                         |
| `missing`              | `user.getInfo` refused with HTTP 503.                                                                    |
| `unknown-registration` | No registration time: `upstream_malformed`, never an empty history.                                      |
| `malformed`            | A scrobble outside the day it was asked for: `upstream_malformed`.                                       |
| `inconsistent`         | A total that the page does not match: `upstream_malformed`.                                              |

Every file must be imported in `src/fixtures.ts`; a test fails otherwise. `src/testing.ts` builds MSW handlers from the raw fixtures for tests (`@min7/contracts/testing`, never imported by production code).

The Last.fm and GitHub `ok` cases are real public data from 2026-10-26. The `lastfm-history` `ok` case is the real set of requests made on 2026-10-26 at 16:31 UTC, approved by the owner and cut down to what the adapter reads: each scrobble's artist, title and time, and the registration time from `user.getInfo`; no profile fields, images, album, MBIDs or URLs. Its other cases are sample data. So is the repo-pulse `ok` case, from its public feed; the other repo-pulse cases are sample data (ADR 0012). The Open-Meteo `ok` case is one real answer for Rabat, fetched 2026-10-26 at 13:44 UTC; the other Open-Meteo cases are sample data built from it. Open-Meteo's data is CC BY 4.0, not MIT (ADR 0022): the weather fixtures keep its values, renamed, unit-checked and with Unix time turned into RFC 3339 in `weather/snapshot/`.

Fixtures hold public data or invented values only, never tokens or private fields.
