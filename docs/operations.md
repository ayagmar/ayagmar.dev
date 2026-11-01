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

1. Apply the migration to production. `just signals-deploy` (what Workers Builds runs on `main`) applies it before deploying; to apply it alone:

   ```sh
   just signals-migrate-remote
   ```

   A failed migration stops the deploy. A Worker rollback does not roll D1 back, and needs not: the previous version never reads `daily`.
2. Deploy signals (merge to `main`, or `just signals-deploy`).
3. Check that the history has days. `upstream_not_found` for `shipping-activity` in `/v1/health` means repo-pulse does not serve `/public/activity` yet; wait for its deploy and the next hourly pull.

   ```sh
   curl -s https://api.ayagmar.dev/v1/health | jq '.sources[] | select(.source == "shipping-activity")'
   curl -s 'https://api.ayagmar.dev/v1/days/shipping-activity?last=28' | jq '.data.days | length'
   ```

4. Rebuild the site once the count is above 0 (a merge to `main`, or a retry of the last site build in Workers Builds). A site built before that keeps the event-based strip until its next build.

The llm-usage history fills with the next accepted push; `/v1/days/llm-usage?month=YYYY-MM` shows it.
