# 0011. Push intake security

Status: accepted, 2026-10-26

## Context

Two producers push to signals over the public internet: the llm-usage-metrics timer on the owner's machine and trellis, a private server. What they push ends up on a public page. An attacker can send any request; a producer can have a bug and send too much. Every accepted byte must be authenticated, bounded, validated and reduced to what the site is meant to show.

## Decision

### Wire format

`POST /v1/push/llm-usage` and `POST /v1/push/trellis`, `Content-Type: application/json`, body:

```json
{
  "producer": "trellis",
  "deliveryId": "3c2b1a09-8f7e-4d6c-b5a4-321f0e9d8c7b",
  "sentAt": "2026-10-26T06:00:00Z",
  "payload": {}
}
```

- `producer` must name the route.
- `deliveryId` is a UUID and the idempotency key. A retry sends the same id and the same bytes.
- `sentAt` (RFC 3339 with offset) is when the producer took the snapshot. It is served as `fetchedAt` and decides `stale` and ordering.
- `payload` is defined per producer: ADR 0013 (trellis) and ADR 0014 (llm-usage). JSON Schema for producers: `packages/contracts/schema/push-<producer>.input.json`.

### Order of checks

`src/intake/handle.ts`, in this order; the first failure answers:
1. Content type is `application/json` (parameters allowed), else **415**.
2. Body read as a stream, at most 64 KiB (`maxPushBodyBytes` in contracts). Reading stops as soon as the stream passes the cap, whatever `Content-Length` says or whether there is one; a declared length over the cap is refused before reading. **413**.
3. Authentication, else **401** `{ "error": "unauthorized" }`, the same body for every reason:
   - Bearer token in `Authorization`, per producer: `PUSH_TOKEN_LLM_USAGE` or `PUSH_TOKEN_TRELLIS`, each with a `_NEXT` slot for rotation. Each slot is compared by SHA-256 digest (equal length) with `crypto.subtle.timingSafeEqual`, every slot is checked, and a slot shorter than 32 characters never matches. A token for one producer fails on the other's route.
   - trellis also signs: `X-Min7-Timestamp` is Unix seconds within ±300 s of the Worker clock, and `X-Min7-Signature` is the lowercase hex HMAC-SHA256 of `timestamp + "." + rawBody` (exact bytes) under `PUSH_HMAC_TRELLIS` or `PUSH_HMAC_TRELLIS_NEXT`, checked with `crypto.subtle.verify`. Token and signature are both always checked.
4. Rate Limiting binding `PUSH_RATE_LIMIT`, keyed by producer, 10 requests per 60 s per Cloudflare location, only after authentication so strangers cannot use up a producer's allowance. Best effort: counts are per location and eventually consistent. **429** `rate_limited`, `Retry-After: 60`.
5. JSON parse (UTF-8, fatal on invalid bytes), else **400** `malformed_json`.
6. Wire schema (zod, from contracts): strict types and ranges, arrays and strings bounded, unknown keys stripped at every level. Else **422** `invalid_payload` with up to 20 `{ path, code }` issues. Paths and codes come from the schema; values are never echoed.
7. Delivery lookup by `(producer, deliveryId)`: same SHA-256 of the raw body, **200** `{ "accepted": true }` and nothing changes; other hash, **409** `delivery_id_reused`. This runs before the freshness and interval checks, so a producer that lost the first response always gets its 200.
8. Freshness for a new delivery: `sentAt` at most 24 h old and at most 5 min ahead, else **422** `sent_at_out_of_window`.
9. Allowlist projection into the published snapshot (below), then validation against the snapshot schema.
10. Atomic admission (ADR 0010): the snapshot is replaced and the delivery recorded together, or neither. Rejections store nothing: **429** `too_soon` with `Retry-After` inside the 60 s minimum interval (the hard ceiling the rate limiter is not), **409** `older_than_current` when the stored snapshot has a later `sentAt`. Success: **202** `{ "accepted": true }`.

The clock is read after the body has arrived, for the signature window, and again just before step 8, for freshness and as the admission time stored for the minimum interval. A client that uploads slowly therefore gains nothing, so there is no separate body-read deadline: a slow upload only holds its own connection, which costs no CPU time.

Every push response has `Cache-Control: no-store` and no CORS headers. A D1 failure is a generic **500** and stores nothing; the producer retries the same delivery.

### Replay

- A captured llm-usage request replays as the same delivery: 200, no change. Changing headers that are not signed (User-Agent, forwarding headers, content-type parameters) does not create a new delivery, because identity is `(producer, deliveryId)` plus the body hash.
- A captured trellis request also fails after 300 s on the timestamp, and its signature cannot be moved to another body.
- Delivery rows are kept 7 days. The 24 h freshness rule means a delivery whose row has expired is refused on `sentAt`, and the ordering rule means an older snapshot never replaces a newer one, so expiry cannot bring old data back.
- Within those 7 days a producer must not reuse an id for different content; it gets 409.

### Allowlists cover values, not only keys

Unknown keys are stripped by the schema, and the projection (`src/intake/llm-usage.ts`, `src/intake/trellis.ts`) builds the snapshot field by field, so nothing unnamed is stored. Identifiers are a second channel: a habit called after a medication, or an agent key that is a file path, would leak through a key-only allowlist. So habit ids and agent ids are looked up in `src/intake/public-labels.ts`, a reviewed map from id to public label; an unknown id is dropped and the label, not the id, is published. Lookups use `Map`, so `constructor` or `__proto__` reach nothing. The only producer-supplied free text that is published is a media or book title, which is public by design. Tests send sensitive strings in permitted fields and in identifiers and assert they are in neither the D1 row nor the response.

### Secrets

Set with `just signals-secrets` (production) and `just signals-preview-secrets` (random fakes in the Preview base config). `secrets.required` in `wrangler.jsonc` lists all six, so a production deploy fails while one is missing; a `_NEXT` slot that is not in use holds a random value nobody has. Rotation is in [docs/operations.md](../operations.md). Secrets are never in config, logs, responses or tests (tests use obviously fake values).

## Consequences

- A producer needs: its token, for trellis the signing key, a UUID per delivery that it keeps across retries, and a retry loop that honours 429 `Retry-After` and treats 409 and 422 as final.
- Raising the 64 KiB cap or the 60 s interval changes the D1 budget in ADR 0010.
- Adding a habit or agent to the site is a one-line, reviewed change to `public-labels.ts`.
