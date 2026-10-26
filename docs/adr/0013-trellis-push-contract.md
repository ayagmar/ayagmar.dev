# 0013. trellis push contract

Status: accepted, 2026-10-26

## Context

trellis is a private app on a private network. signals never contacts it. trellis pushes a small public summary for `/v1/shelf`: what the owner is reading and watching, books finished this year and habit streaks. Everything else trellis knows stays there, so the contract is an allowlist, enforced on both sides.

## Decision

### Request

`POST https://api.ayagmar.dev/v1/push/trellis`

| Header             | Value                                                                           |
| ------------------ | ------------------------------------------------------------------------------- |
| `Content-Type`     | `application/json`                                                              |
| `Authorization`    | `Bearer <PUSH_TOKEN_TRELLIS>`                                                   |
| `X-Min7-Timestamp` | Unix time in seconds when the request is signed                                 |
| `X-Min7-Signature` | lowercase hex HMAC-SHA256 of `timestamp + "." + body` under `PUSH_HMAC_TRELLIS` |

The signature covers the exact bytes sent as the body. Sign after serializing and send those bytes unchanged. Re-signing a retry with a new timestamp is fine; the body, and so its `deliveryId`, stays the same.

Body (schema: `packages/contracts/schema/push-trellis.input.json`; examples: `packages/contracts/fixtures/trellis/push/`):

```json
{
  "producer": "trellis",
  "deliveryId": "3c2b1a09-8f7e-4d6c-b5a4-321f0e9d8c7b",
  "sentAt": "2026-10-26T06:00:00Z",
  "payload": {
    "booksFinished": { "year": 2026, "count": 14 },
    "inProgress": [
      { "title": "Vagabond", "kind": "manga", "progress": { "current": 214, "total": 327 } },
      {
        "title": "Ascendance of a Bookworm",
        "kind": "light-novel",
        "progress": { "current": 9, "total": null }
      }
    ],
    "habits": [{ "habit": "meditation", "streakDays": 31 }]
  }
}
```

| Field                   | Rule                                                                             |
| ----------------------- | -------------------------------------------------------------------------------- |
| `booksFinished.year`    | integer 2000–2100, the calendar year counted                                     |
| `booksFinished.count`   | integer 0–10,000, books finished in that year                                    |
| `inProgress`            | at most 50 items being read or watched now                                       |
| `inProgress[].title`    | 1–200 characters, no control characters; published as is                         |
| `inProgress[].kind`     | `anime`, `manga`, `light-novel` or `book`                                        |
| `inProgress[].progress` | `current` integer 0–100,000; `total` integer 1–100,000, or null while unknown    |
| `habits`                | at most 50 items                                                                 |
| `habits[].habit`        | habit id, 1–128 characters; published only if signals has a label for it (below) |
| `habits[].streakDays`   | integer 0–36,600                                                                 |

Size cap 64 KiB. Unknown fields are ignored and never stored, but trellis must not send them (below).

### What signals publishes

`GET /v1/shelf` (schema: `packages/contracts/schema/shelf.output.json`): `booksFinished`, `inProgress` as sent, and `habits` with each id replaced by its public label, longest streak first. Habit ids without a label in `apps/signals/src/intake/public-labels.ts` (currently `meditation`, `reading`, `writing`) are dropped. Adding one is a reviewed change in this repo.

### Allowlist on the trellis side

Signals' allowlist is the second line, not the first. The trellis job must build the body from an explicit public-summary allowlist of its own: named fields only, habits only from a list the owner marked public, no free text except titles. Nothing about health, money, people, places, notes, moods or anything else trellis stores. A test on the trellis side asserts the serialized body for a fully populated account contains only the fields above.

### Schedule, retries, rotation

- Push once a day, and when a tracked item changes if that is easy. More than one accepted push a minute is refused with 429.
- Keep one `deliveryId` per summary until it gets a 2xx, 409 or 422. Retry on network errors, 5xx and 429 (after `Retry-After`) with backoff. A 409 `older_than_current` means a newer summary is already stored.
- `sentAt` must be within 24 h of receipt; a summary that could not be delivered for a day is rebuilt with a new id.
- `/v1/shelf` reports `stale: true` 3 days after the last `sentAt`.
- Token and signing key rotate independently with the `_NEXT` slots (docs/operations.md). trellis reads both values from its own secret store.

## Consequences

Kotlin validates its body against `push-trellis.input.json` before sending. Adding a field to the shelf means: contracts schema, signals projection, this ADR, then trellis.
