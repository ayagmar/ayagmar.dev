# 0033. Monkeytype personal bests

Status: accepted, 2026-10-26

## Context

The owner asked for their Monkeytype personal bests on `/stats` (backlog item 4): one headline number and the rest compactly, read in the browser like the other `/stats` panels, with no home-page change. Monkeytype needs an ApeKey, a credential tied to the owner's account, so the key's path out of the Worker, the account's rate limit and what of the answer gets published all need deciding.

## Decision

### Source: `GET /users/personalBests`

From Monkeytype's API docs (https://api.monkeytype.com/docs, API version 2.5.0, retrieved 2026-10-26): authentication is the header `Authorization: ApeKey <key>`; `mode` (`time`, `words`, `quote`, `custom`, `zen`) is required and `mode2` optional; the endpoint answers 470 "Invalid ApeKey", 471 "ApeKey is inactive", 472 "ApeKey is malformed" and 479 "ApeKey rate limit exceeded" besides 400, 401, 403, 422, 429, 500 and 503. Its example shows `data` as a single personal best.

The server sends something else. In Monkeytype's repository at commit `846ead72b5925a81a1389436b7e21e0948e8cb86` (2026-10-26), `getPersonalBests` in `backend/src/dal/user.ts` returns `user.personalBests[mode]`, and the controller in `backend/src/api/controllers/user.ts` wraps it as `{ message, data }` with `null` for none: a map from test length (`"60"`) to an array of bests, one per combination of language, difficulty and flags. The authorized capture on 2026-10-26 at 23:12 UTC confirmed that shape: `?mode=time` answered `{ message, data: { "15": [2 bests], "30": [1], "60": [1] } }`, `?mode=words` answered `{ message, data: null }`. `PersonalBestSchema` (`packages/schemas/src/shared.ts`) gives a best's fields: `acc`, `consistency`, `difficulty`, `language`, `raw`, `wpm`, `timestamp`, and optional `punctuation`, `numbers`, `lazyMode`. `backend/src/utils/pb.ts` reads an absent flag as false when it matches results to bests, and sets `timestamp` from `Date.now()`, in Unix milliseconds.

One pull is two requests, one after the other: `?mode=time` and then `?mode=words`, without `mode2`. Nothing else on the API is asked (not `/users`, the profile, tags or results). The second is not made when the first fails.

### Rate limits

- The docs: "a rate limit of `30 requests per minute` across all endpoints with some endpoints being more strict. Rate limit rates are shared across all ape keys"; for this endpoint, "can be called up to 60 times per hour for regular users".
- The repository (`backend/src/middlewares/rate-limit.ts`, `packages/contracts/src/rate-limit/index.ts`): the endpoint's limiter is `userGet` (60 an hour), but a request authenticated with an ApeKey uses `defaultApeRateLimit` instead, 30 a minute, keyed by the account's uid, so a second key on the same account shares it. Over its limit an ApeKey request gets 479; others get 429. A root limiter allows 1,000 requests an hour per address. The 30-a-day limit on `/results` does not apply here.

signals makes 2 requests every 6 hours, 8 a day; the runner's 30-second early allowance (ADR 0010) cannot add a pull. No other integration on the owner's account uses the API today; one that does shares the same 30 a minute.

### The ApeKey

- Monkeytype has no personal-bests-only key. A key has a name and an enabled flag (`packages/schemas/src/ape-keys.ts`) and reads whatever endpoints accept ApeKeys; this one is not narrower than any other. It stays in signals; the site has none.
- Optional, so it cannot block a signals deploy: `readSecret` knows `MONKEYTYPE_APE_KEY`, but it is not in `secrets.required` or the justfile's required list. Without it the adapter asks nothing and fails with `not_configured`, which keeps the snapshot and its `fetchedAt`; the runner records the attempt, so it logs one `pull failed` line with that code per attempt, four a day, and holds no state between invocations.
- `secrets.required` also limits which names Wrangler loads from `.dev.vars` locally (https://developers.cloudflare.com/workers/configuration/secrets/), so an ApeKey there does not reach `just signals-dev`. Tests pass a fake key in `env`; the live capture ran outside Wrangler with the key in that one command's environment.
- The key goes only to `api.monkeytype.com`, in the header, never in a URL (Workers traces record URLs). `getJson` takes `redirect: 'manual'` for these requests: Workers forwards every header, `Authorization` included, to wherever a followed redirect points (https://developers.cloudflare.com/workers/runtime-apis/request/), so a 3xx is answered as `upstream_http_error`, same host or not. Other adapters keep following redirects; GitHub's renamed repositories need it. Same 5-second deadline over headers and body, `min7-signals (+https://ayagmar.dev)` User-Agent, and a 128 KiB body cap checked against `Content-Length` and while streaming.
- `getJson` now also stops reading a body that stalls after its headers when its deadline passes. Before, that guarantee leaned on the runtime tying the body to the request's signal, which a mocked response does not; every adapter gets the fix, and nothing else in its behaviour changes.

Statuses:

| Answer                                 | Code                                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------ |
| 401, 403, 470, 471, 472                | `upstream_unauthorized`, new: the key is refused, revoked, disabled or mangled |
| 429, 479                               | `upstream_rate_limited`, with a usable `Retry-After` kept in D1 (ADR 0030)     |
| 404, 410                               | `upstream_not_found`                                                           |
| 3xx, 5xx, anything else but 200        | `upstream_http_error`                                                          |
| A body that is not the map, a bad best | `upstream_malformed`                                                           |
| No answer in 5 s, a body over 128 KiB  | `upstream_timeout`, `upstream_too_large`                                       |

Every failure keeps the whole last snapshot and its `fetchedAt`; a pull whose words request fails after time succeeded publishes nothing. Neither request is retried within an invocation, and no other key or address is tried. The runner never pulls before a recorded `Retry-After` time, with no early allowance, and otherwise waits the 6-hour interval: a `Retry-After` shorter than that changes nothing, a longer one (up to the day the runner accepts) delays the next pull. Logs and `/v1/health` carry the code only, never a message, body or header.

### What is published

Exactly eight slots, `time` 15, 30, 60 and 120 seconds and `words` 10, 25, 50 and 100, each `{ wpm, acc, raw, consistency, date }` or null. A best counts when its `language` is exactly `english` (not `english_1k` or another list), its `difficulty` is `normal`, and each of `punctuation`, `numbers` and `lazyMode` is absent or `false`. A flag that is `true` leaves the best out. A missing language or difficulty, a flag of another type (null, a string), WPM or raw below 0 or not a number, accuracy or consistency outside 0 to 100, or a timestamp that is not a whole number of milliseconds in years 1970 to 9999 fails the pull as `upstream_malformed`: an unreadable best is not an empty account. Only the eight lengths' bests are checked; other lengths and modes are not read. `data: null`, an empty map, an absent length and an empty list all mean no best there, so the slot is null, never 0.

Of the matching bests at a length, the one with the highest WPM wins, then the higher accuracy, the more recent, the higher raw and the higher consistency; all five numbers come from that one record. `date` is the UTC day of its timestamp (`2021-01-14`), not the millisecond time: the orchestrator decided on 2026-10-26 to publish the day only. It says when the best was set, never when signals fetched it.

These numbers and days are the owner's own and deliberately public, not anonymized: a best and its day could be matched to the owner's Monkeytype profile. The answer's other content is dropped by the wire schema and then by the output schema: the upstream message, any user id, name or other field around the data or in a best, and every best at other settings. The page says what the bests are at, "English · normal · no punctuation or numbers", and claims no more: a personal best does not record every setting of the test it came from, and these are not leaderboard results.

### signals: the `monkeytype` source

- `apps/signals/src/adapters/pull/monkeytype.ts`, appended to the registry: one adapter, both requests, `intervalSeconds` 21,600 (6 hours).
- `staleAfterSeconds.monkeytype` 86,400 (a day, three missed pulls), from the last successful fetch only, never from a best's date: a best set years ago is still current.
- `GET /v1/monkeytype` is `snapshotRoute('monkeytype')`, unchanged: the envelope, `stale`, at most 60 seconds of edge and browser cache and never past the stale moment, the query-free cache key, HEAD, OPTIONS and CORS as for every source. A read never calls Monkeytype, cached or not.
- Contracts: `monkeytypeBestsSchema` and `monkeytypeBucketSchema` (wire), `monkeytypeSnapshotSchema` and `monkeytypeEnvelopeSchema` (output). The whole envelope is exported as `schema/monkeytype.{input,output}.json` with its own accept and reject corpus and frozen as `test/frozen/v1/monkeytype.output.json` (ADR 0008); the generic envelope's corpus and frozen file are unchanged.
- Fixtures: `monkeytype/raw/*` as `{ time, words }`, each a recorded answer, `words` null when it was not asked, and `monkeytype/snapshot/*` (`packages/contracts/fixtures/README.md`). The `ok` case is a minimized real capture, made on 2026-10-26 at 23:12 UTC with the owner's key by a one-off script that printed only the answer's shape: only the bests the page can show, only the ten fields the adapter reads, timestamps cut to the UTC day, no message. The other cases are invented, among them `sensitive-fields`, with fake ids, a name, an email and new fields in and around the data, which `test/monkeytype.test.ts` follows into D1, `/v1/monkeytype` and the logs and finds in none of them.

### Scheduling

One adapter per invocation still, on the same minute trigger: no new trigger and no shared invocation. A sixth pulled source costs the others a minute in two places, measured with the real registry in `apps/signals/test/cron.test.ts`, which now runs Monkeytype in its two-day simulation (no key for the first day, refused once with a key, then answering):
- Listening's first gap after a cold start, while each of the other five sources is tried once, is 6 minutes (it was 5); after that it stays at most 3. Approved by the orchestrator on 2026-10-26 up to 6; the test asserts 6 for the first gap and keeps 5 for the rest.
- The history's worst case at midnight (every source due, the history last attempted at 23:58, the 00:02 and 00:03 triggers lost, three past years) publishes at 10 minutes 2.3 seconds (it was 9 minutes 2.3 seconds). Approved up to 11 minutes; the test asserts the measured 10 minutes 2.3 seconds.
- Over the two days: Monkeytype at most 6 hours 3 minutes apart, shipping 17 minutes, weather 16, projects 24 hours 1 minute, and the history 5 minutes 2.3 seconds after the first midnight and 11 minutes 2.3 seconds after the second, where its first attempt fails (bound 15).

Subrequests: 2 a pull, counted by `test/monkeytype.test.ts`. CPU, from `just signals-cpu` (two runs, each over a no-adapter baseline of 8.6 ms cold): with the real answers (0.7 KiB), 2.6 and 5.4 ms cold and under 1 ms warm; with answers near the 128 KiB cap (ten lengths of 40 bests in each mode), 10.6 and 14.9 ms cold and 0.7 and 3.2 ms warm median. These are local numbers, as noisy as ADR 0030 says; cold invocations over 10 ms are already the case for other adapters and are `fix/cron-cpu`'s subject, not settled here.

### The site: a live `/stats` panel

The typing panel is built like its neighbours (ADR 0015): the build reads `/v1/monkeytype` in `api` mode and the `ok` fixture in `fixtures` mode (tape-labelled sample data, no request), and renders it as the first paint and the no-JavaScript page. `src/scripts/stats-live.ts` keeps it current through `live('monkeytype', …)` from `src/lib/live.ts`: asks on load if visible, then hourly while visible, one request at a time with the 5-second deadline, no cache-busting; only a valid, unflagged, fresh and not older answer replaces what is shown; the "Updated …" line ages and turns "May be out of date: updated …" past a day. `readMonkeytype` (`src/lib/typing.ts`) checks every slot as the contract does; `test/live.test.ts` holds it to the zod schema on the fixtures, the reject corpus and edge cases.

What it shows: the 60-second best as the headline ("104 wpm over 60 seconds at 92% accuracy, set 5 years ago"), or "No 60-second best yet." when there is none, never another length's; then one row per best there is ("15 seconds: 123 wpm, 95%, 4 years ago"), and the settings line. With bests at none of the eight lengths: "No personal bests at these settings yet."; with no snapshot at all: "No typing data yet." WPM and accuracy are rounded to whole numbers. Each day is a `<time datetime="2021-01-14" data-day>`: the build writes the date ("14 Jan 2021"), and the page's script rewrites it as a relative day, again each minute and whenever the tab comes back, whether or not a new answer arrived ("today", "yesterday", "12 days ago", "3 months ago", "5 years ago"), with the date in its title. The day counts on the reader's own calendar: the published date is a date, compared with the reader's date at that moment, never turned into an instant and moved into their time zone. A best dated 26 October is "yesterday" in Tokyo as soon as the 27th begins there, and still "today" in Los Angeles until the 26th ends there. The freshness line says when signals last fetched; the days say when each best was set.

Costs:

| What                                 | Before  | After                                              | Limit                                 |
| ------------------------------------ | ------- | -------------------------------------------------- | ------------------------------------- |
| `/stats` script, gzip 9              | 2,973 B | 3,739 B                                            | 3,750 B (was 3,000 B; ADR 0017)       |
| Live reads chunk (`live.*.js`)       | 1,363 B | 1,387 B                                            | 1,400 B (ADR 0017)                    |
| Upstream requests (Monkeytype)       | 0       | 8 a day                                            | 30 a minute, shared by the account    |
| Browser requests to `/v1/monkeytype` | 0       | 1 on load, then 1 an hour per visible `/stats` tab | Workers Free 100,000 a day (ADR 0010) |

The 766 B are the reader, the renderer, the words and the day formatting. The live-reads chunk grows 24 B: `day()` is exported for the reader's calendar, and `live()` takes a `relabel` hook that runs with `tick()`, so the days turn over on the minute timer and tab returns it already has. The home, `/uses`, listening-reads and agent-reads files that import it change only in its file name.

### Operator commands

Before merge, with values never on a command line:

```sh
just signals-secret MONKEYTYPE_APE_KEY          # production: Wrangler prompts for the key
just signals-preview-secret MONKEYTYPE_APE_KEY  # Preview base config: a random fake, shown to no one
```

The first deploys a new production version. The second reaches Previews created after it; an existing Preview keeps its secrets until it is recreated. Previews have no cron, so their fake key is never sent anywhere, and no route runs a pull.

## Consequences

- With the key unset or refused, the panel keeps the last bests and ages honestly; `/v1/health` shows `not_configured` or `upstream_unauthorized`.
- Listening starts a minute later after a cold start, and the history's worst midnight case is a minute later. A seventh pulled source would push both again and needs its own decision.
- If Monkeytype makes the deployed answer match its docs (a single best in `data`), every pull fails as `upstream_malformed` and the bests age out after a day: the shape is checked, not guessed.
- The `/stats` script has 25 B of headroom.
