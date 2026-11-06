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

## Listening and weather days (ADR 0038)

These need no migration and no new secret. Merging to `main` deploys them through Workers Builds, and recording starts on its own: weather at the next pull, listening in the first minutes of the next hour. A Worker rollback needs nothing either: the older version ignores the new rows and answers 404 on the two new routes.

Check that days arrive. A Preview cannot show this, as cron triggers never run there.

```sh
curl -s 'https://api.ayagmar.dev/v1/days/listening?last=28' | jq '.data.days[-2:]'
curl -s 'https://api.ayagmar.dev/v1/days/weather?last=28' | jq '.data.days[-2:]'
```

No listening row an hour after the deploy means the day reads fail: look for `day read failed` in Workers Logs. The pull's snapshot is not affected by that, so `/v1/health` stays clean. A block's `fetchedAt` is when the source was last collected, not when that day was: read `asOf` and each slot's `at`.

### Backfilling past days

Fills past dates of both series, one date a minute, in production only: cron triggers never run in Previews, and no key leaves the Worker. Wrangler needs a login with D1 access; nothing else is secret. The range includes both dates, must end before today in Rabat, starts no earlier than 2025-01-01 and spans at most 400 days. A date is fetched only when the backfill reaches it, so try one first:

```sh
just signals-backfill 2026-10-01 2026-10-01
```

A minute or two later, check the date and that the row says it finished (`json` is `null`):

```sh
curl -s 'https://api.ayagmar.dev/v1/days/listening?month=2026-10' | jq '.data.days[0]'
curl -s 'https://api.ayagmar.dev/v1/days/weather?month=2026-10' | jq '.data.days[0]'
pnpm --filter @min7/signals exec wrangler d1 execute DB --remote --command "SELECT described_date, step, json FROM pull_progress WHERE source = 'daily-backfill'"
```

Edge caching holds a month block for up to 60 seconds. Then arm the rest, which takes about a minute per date:

```sh
just signals-backfill 2026-10-02 2026-11-05
```

Workers Logs has one `backfill day` line per date. It stops by itself:

- After the last date: `json` is `null`.
- After 5 failed tries on a date: a `backfill stopped` line, and `json` holds `"stopped":true` with `next`, the date it stopped on. Fix the cause, then arm again from `next`.
- On a range it refuses: a `backfill refused` line, no request made, `json` is `null`.

Arming again is always safe, also over a running backfill and over dates already filled: a date only ever gains what it lacked, and a live weather slot is never replaced by an archived one. To cancel, arm nothing and clear the row's state:

```sh
pnpm --filter @min7/signals exec wrangler d1 execute DB --remote --command "UPDATE pull_progress SET json = 'null', step = step + 1 WHERE source = 'daily-backfill'"
```
