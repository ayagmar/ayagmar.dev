# Operations

## Push secrets

signals has six push secrets, all listed in `secrets.required` in `apps/signals/wrangler.jsonc`, so a deploy fails while one is missing:

| Secret                      | Used for                               |
| --------------------------- | -------------------------------------- |
| `PUSH_TOKEN_LLM_USAGE`      | Bearer token of the llm-usage producer |
| `PUSH_TOKEN_LLM_USAGE_NEXT` | Next llm-usage token during a rotation |
| `PUSH_TOKEN_TRELLIS`        | Bearer token of trellis                |
| `PUSH_TOKEN_TRELLIS_NEXT`   | Next trellis token during a rotation   |
| `PUSH_HMAC_TRELLIS`         | Key trellis signs requests with        |
| `PUSH_HMAC_TRELLIS_NEXT`    | Next signing key during a rotation     |

signals accepts a request that matches either slot. A missing value, or one shorter than 32 characters, never matches, so the current slot alone works. Outside a rotation, each `_NEXT` slot holds a random value nobody has.

Generate every value with `openssl rand -hex 32`. Wrangler reads it from the prompt; never put a value on a command line, in a file in the repo, or in chat.

### First setup

```sh
just signals-secrets           # prompts for each of the six values
just signals-preview-secrets   # random fakes for Previews, shown to no one
```

`just signals-secrets` runs `just signals-secret <name>` (`wrangler secret put`) for each name. If the Worker does not exist yet, Wrangler offers to create it; accept. Every `secret put` deploys a new version of the Worker.

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
