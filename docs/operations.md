# Operations

## Push secrets

signals has eight push secrets, listed in `secrets.required` in `apps/signals/wrangler.jsonc` with `LASTFM_API_KEY`, so a deploy fails while one is missing (the pull secrets are in [docs/deploy.md](deploy.md)):

| Secret                      | Used for                               |
| --------------------------- | -------------------------------------- |
| `PUSH_TOKEN_LLM_USAGE`      | Bearer token of the llm-usage producer |
| `PUSH_TOKEN_LLM_USAGE_NEXT` | Next llm-usage token during a rotation |
| `PUSH_TOKEN_TRELLIS`        | Bearer token of trellis                |
| `PUSH_TOKEN_TRELLIS_NEXT`   | Next trellis token during a rotation   |
| `PUSH_HMAC_TRELLIS`         | Key trellis signs requests with        |
| `PUSH_HMAC_TRELLIS_NEXT`    | Next signing key during a rotation     |
| `PUSH_TOKEN_DESKTOP`        | Bearer token of the desktop producer   |
| `PUSH_TOKEN_DESKTOP_NEXT`   | Next desktop token during a rotation   |

signals accepts a request that matches either slot. A missing value, or one shorter than 32 characters, never matches, so the current slot alone works. Outside a rotation, each `_NEXT` slot holds a random value nobody has.

Generate every value with `openssl rand -hex 32`. Wrangler reads it from the prompt; never put a value on a command line, in a file in the repo, or in chat.

### First setup

```sh
just signals-secrets           # prompts for LASTFM_API_KEY and each of the eight values
just signals-preview-secrets   # random fakes for Previews, shown to no one
```

`just signals-secrets` runs `just signals-secret <name>` (`wrangler secret put`) for each name. If the Worker does not exist yet, Wrangler offers to create it; accept. Every `secret put` deploys a new version of the Worker.

### Adding a producer's secrets

A new name in `secrets.required` makes the next production deploy fail until it is set, and merging to `main` deploys. So set a new producer's slots before its change is merged: the current slot with the value the producer will use, the next slot with a random value nobody keeps. For the desktop producer (ADR 0032):

```sh
just signals-secret PUSH_TOKEN_DESKTOP        # paste the value of PUSH_TOKEN_DESKTOP from ~/.config/ayagmar.dev/signals.env
openssl rand -hex 32 | just signals-secret PUSH_TOKEN_DESKTOP_NEXT
openssl rand -hex 32 | pnpm --filter @min7/signals exec wrangler preview base-config secret put PUSH_TOKEN_DESKTOP
openssl rand -hex 32 | pnpm --filter @min7/signals exec wrangler preview base-config secret put PUSH_TOKEN_DESKTOP_NEXT
```

The current Worker ignores secrets it does not use, so setting them early is safe. The producers on the owner's machine read their tokens from `~/.config/ayagmar.dev/signals.env` (mode 600), one `NAME=value` line each, and only their own line (docs/producers/).

### Rotate a token or key

Example for the trellis token; the same steps work for every secret.

1. Generate the new value and set it in the next slot: `just signals-secret PUSH_TOKEN_TRELLIS_NEXT`. signals now accepts the old and the new value.
2. Switch the producer to the new value and check one push gets 2xx (`GET https://api.ayagmar.dev/v1/health` shows the source's `lastSuccessAt` move).
3. Set the same new value in the current slot: `just signals-secret PUSH_TOKEN_TRELLIS`.
4. Retire the old value: set the next slot to a fresh random value, `just signals-secret PUSH_TOKEN_TRELLIS_NEXT`.

If a value leaked, do steps 1 to 4 at once and skip waiting in step 2: after step 4 the leaked value matches neither slot.

### Rotate Preview secrets

`just signals-preview-secrets` again. Base config secrets apply to Previews created afterwards; existing Previews keep theirs until they are recreated.

## GitHub token

`GITHUB_TOKEN` (docs/deploy.md) is a fine-grained token, and those expire. When it does, the project logs stop updating and `/v1/health` shows `upstream_unauthorized` for `project-events`. Before it expires, make a new one with the same settings (no permissions, public repositories only) and set it with `just signals-secret GITHUB_TOKEN`; within an hour `project-events` shows a new `lastSuccessAt`.

## Checking the Worker

- `GET https://api.ayagmar.dev/v1/health`: deployed commit, and per source `lastSuccessAt`, `stale` and `lastErrorCode`.
- Workers Logs: every log line is JSON with a `message` and a `code`. `push rejected` lines carry `producer`, `status` and `code`; `pull failed` lines carry `source` and `code`; `cron run` lines count pulls and deleted deliveries.

## Rolling out daily history (ADR 0038)

The `daily` table, the activity pull and `/v1/days` ship in signals; the strip reads them when the site is built. In this order:

1. Apply the migrations to production. `just signals-deploy` (what Workers Builds runs on `main`) applies them before deploying; to apply them alone:

   ```sh
   just signals-migrate-remote
   ```

   `0004_daily.sql` adds the `daily` table and `0005_snapshot_write_id.sql` a nullable `snapshots.write_id` column. The shared preview database needs 0005 too before a preview's activity pull can store (`just signals-migrate-preview`). A failed migration stops the deploy. A Worker rollback does not roll D1 back, and needs not: the previous version never reads either.
2. Deploy signals (merge to `main`, or `just signals-deploy`).
3. Check that the history has days. `upstream_not_found` for `shipping-activity` in `/v1/health` means repo-pulse does not serve `/public/activity` yet; wait for its deploy and the next hourly pull. `upstream_incomplete` is retried every 2 minutes.

   ```sh
   curl -s https://api.ayagmar.dev/v1/health | jq '.sources[] | select(.source == "shipping-activity")'
   curl -s 'https://api.ayagmar.dev/v1/days/shipping-activity?last=28' | jq '.data.days | length'
   ```

4. Rebuild the site once the count is above 0 (a merge to `main`, or a retry of the last site build in Workers Builds). A site built before that keeps the event-based strip until its next build.

The llm-usage history fills with the next accepted push; `/v1/days/llm-usage?month=YYYY-MM` shows it.

## Changing the featured projects (ADR 0009)

Production builds the site from the stored `projects` snapshot, and the merge that changes `featuredProjects` deploys signals and the site together. The site is therefore built from the snapshot of the old list: new projects show no numbers and `/stats` counts the old set, until the site is built again. After merging, wait for the first `projects` pull (up to 6 hours), then rebuild the site (a merge to `main`, or a retry of the last site build in Workers Builds):

```sh
curl -s https://api.ayagmar.dev/v1/health | jq '.sources[] | select(.source == "projects")'
```

The pull has run when `lastSuccessAt` is later than the deploy.

Removing a project needs none of this: the site ignores a snapshot entry for a slug that is no longer featured, and the next `project-events` pull drops it. Its page and feeds answer 404 from the deploy on. To tell Bing and the other IndexNow engines sooner than their next crawl:

```sh
just indexnow https://ayagmar.dev/projects/<slug> https://ayagmar.dev/projects
```

## Listening and weather days (ADR 0038)

These need no migration and no new secret. Merging to `main` deploys them through Workers Builds, and recording starts on its own: weather at the next pull, listening in the first minutes of the next hour. A Worker rollback needs nothing either: the older version ignores the new rows and answers 404 on the two new routes.

Check that days arrive. A Preview cannot show this, as cron triggers never run there.

```sh
curl -s 'https://api.ayagmar.dev/v1/days/listening?last=28' | jq '.data.days[-2:]'
curl -s 'https://api.ayagmar.dev/v1/days/weather?last=28' | jq '.data.days[-2:]'
```

Whether a series is recording is on `/v1/health`, under `days`, apart from the source's own row: a failing day read leaves the snapshot and `sources` clean.

```sh
curl -s https://api.ayagmar.dev/v1/health | jq '.days'
```

`retryAfterAt`, in Unix ms, is a Last.fm refusal of the day reads: until then neither live day reads nor a backfill ask. `lastErrorCode` with `lastErrorDate` is the latest failure, and stays until a pull records every date it read. `stale: true` means nothing recorded for 3 hours (listening) or 45 minutes (weather); listening is also stale until the first hour after a deploy. `upstream_malformed` for listening means Last.fm's range answer differs from what `readRangePage` checks; `upstream_future` for weather means Open-Meteo dated a reading ahead of the clock, and it was not recorded. Workers Logs has a `day read failed` line for each, with the code. Days missed while failing stay missing until a backfill covers them. A block's `fetchedAt` is when the source was last collected, not when that day was: read `asOf` and each slot's `at`.

### Backfilling past days

Fills past dates of both series, about one date every two minutes, in production only: cron triggers never run in Previews, and no key leaves the Worker. Wrangler needs a login with D1 access; nothing else is secret. The range includes both dates, must end before today in Rabat, starts no earlier than 2025-01-01 and spans at most 400 days. A date is fetched only when the backfill reaches it, so try one first:

```sh
just signals-backfill 2026-10-01 2026-10-01
```

A few minutes later, check the date and that the row says it finished (`json` is `null`):

```sh
curl -s 'https://api.ayagmar.dev/v1/days/listening?month=2026-10' | jq '.data.days[0]'
curl -s 'https://api.ayagmar.dev/v1/days/weather?month=2026-10' | jq '.data.days[0]'
pnpm --filter @min7/signals exec wrangler d1 execute DB --remote --command "SELECT described_date, step, json FROM pull_progress WHERE source = 'daily-backfill'"
```

Edge caching holds a month block for up to 60 seconds. Then arm the rest, which takes about two minutes per date, and pauses for the first 15 minutes of each date in Rabat:

```sh
just signals-backfill 2026-10-02 2026-11-05
```

Workers Logs has one `backfill day` line per date. It waits by itself: `notBefore` in `json` is the Unix ms of the next try, a time the upstream gave with `Retry-After`, an hour when the archive lacks an hour, else 5 minutes. A cooldown already recorded for `listening`, `listening-history` or `weather`, or a `retryAfterAt` under `days` on `/v1/health`, holds it too. Waiting asks nothing and spends no try. It stops by itself:

- After the last date: `json` is `null`.
- After 5 failed tries on a date: a `backfill stopped` line, and `json` holds `"stopped":true` with `next`, the date it stopped on, and `code`, why. Fix the cause, then arm again from `next`. `upstream_incomplete` means the archive never reached one of that date's two hours: what it did have is kept, and the date is incomplete, not done.
- On a range it refuses: a `backfill refused` line, no request made, `json` is `null`.

Arming again is always safe, also over a running backfill and over dates already filled: a date only ever gains what it lacked, and a live weather slot is never replaced by an archived one. To cancel, arm nothing and clear the row's state:

```sh
pnpm --filter @min7/signals exec wrangler d1 execute DB --remote --command "UPDATE pull_progress SET json = 'null', step = step + 1 WHERE source = 'daily-backfill'"
```
