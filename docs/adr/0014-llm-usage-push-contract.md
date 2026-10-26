# 0014. llm-usage push contract

Status: accepted, 2026-10-26. Amended 2026-10-26: estimated agent hours (`activeMs`), the producer's three calls in one reporting zone, and its delivery rules (ADR 0032).

## Context

[llm-usage-metrics](https://github.com/ayagmar/llm-usage-metrics) reads coding-agent session logs on the owner's machine and reports cost and tokens. `/v1/llm-usage` shows a few totals from it. Session logs hold prompts, file paths and repository names; none of that may leave the machine.

## Decision

### Request

`POST https://api.ayagmar.dev/v1/push/llm-usage` with `Content-Type: application/json` and `Authorization: Bearer <PUSH_TOKEN_LLM_USAGE>`. No signature: the token is the only credential, and the content is aggregate numbers.

Body (schema: `packages/contracts/schema/push-llm-usage.input.json`; examples: `packages/contracts/fixtures/llm-usage/push/`):

```json
{
  "producer": "llm-usage",
  "deliveryId": "0f8e7c52-3c1a-4f7e-9b0a-1d2c3e4f5a6b",
  "sentAt": "2026-10-26T08:00:00Z",
  "payload": {
    "last7Days": { "costUsd": 41.37, "totalTokens": 16440000 },
    "monthToDate": {
      "costUsd": 152.8,
      "totalTokens": 61250000,
      "cacheSavingsUsd": 310.45,
      "agents": [{ "agent": "claude", "costUsd": 98.1, "totalTokens": 39800000 }]
    },
    "streak": { "currentDays": 4, "longestDays": 23 },
    "days": [{ "date": "2026-10-25", "costUsd": 5.55, "totalTokens": 2040000 }]
  }
}
```

| Field                         | Rule                                                                     | From `llm-usage ... --json`                                   |
| ----------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------- |
| `last7Days`, `monthToDate`    | `costUsd` 0–1,000,000 or null when unpriced; `totalTokens` integer ≥ 0   | `summary`: `periods[key=last7Days\|monthToDate].totals`       |
| `monthToDate.cacheSavingsUsd` | 0–1,000,000 or null                                                      | `summary`: `monthToDateCacheSavingsUsd`                       |
| `monthToDate.agents`          | at most 32; `agent` is the llm-usage source id, with its cost and tokens | `summary`: `periods[key=monthToDate].sources`                 |
| `streak`                      | `currentDays`, `longestDays`, integers 0–36,600                          | `summary`: `activity.currentStreak`, `activity.longestStreak` |
| `days`                        | at most 371 (53 weeks), `date` `YYYY-MM-DD`, cost and tokens per day     | `daily --since <from> --until <to>`: `period_combined` rows   |
| `days[].activeMs`             | optional, integer 0–90,000,000 (25 hours)                                | `trends --metric active-hours`: `totalSeries.buckets[].value` |
| `last7Days.activeMs`          | optional, integer 0–630,000,000 (7 × 25 hours)                           | sum of the buckets from the period's `since` to `until`       |
| `monthToDate.activeMs`        | optional, integer 0–2,790,000,000 (31 × 25 hours)                        | sum of the buckets from the period's `since` to `until`       |

Null costs stay null. A guessed 0 would show a free month. Size cap 64 KiB; a full year is about 25 KiB, and agent hours add about 7 KiB.

### Estimated agent hours

`activeMs` is llm-usage's active time: within each session, the time between consecutive logged events, each gap capped at 5 minutes, and the union over all sessions, sources and machines (the laptop included, as llm-usage counts it by default), so overlapping sessions count once. It is an estimate, not measured runtime and not the owner's time at the keyboard:
- A session with a single event counts 0, and so do sources that log one event per session (droid, goose). Rows without their own time collapse onto the session start.
- A 20-minute build between two events counts 5 minutes; part of an idle gap counts too.
- A session that crosses midnight is split there, and the gap across midnight counts on neither day.
- Agents that work overnight or unattended count in full.

Days are local calendar days in Africa/Casablanca. A local day lasts 23, 24 or 25 hours (2026-02-15 ran from 23:00 UTC on the 14th to 00:00 UTC on the 16th), so the daily bound is 25 hours and no valid value is clamped. The three fields are optional and have no default: absent means unknown, never 0 h, and a real zero is sent as 0. signals keeps each value it was sent and leaves the key out otherwise.

**Compatibility.** A producer without hours keeps working with the new Worker: its pushes are valid and show no hours. A new producer's push to a Worker from before this change is valid too, but that Worker strips the hours. Retrying an accepted delivery after the Worker is upgraded gets 200 and changes nothing, so hours appear with the next new delivery, not by replaying an old one. Current output with hours still validates against the frozen v1 consumer schemas (`llm-usage.output.json`, `push-llm-usage.output.json`), which are unchanged.

**On `/stats`.** "Estimated agent hours" shows this month so far and the last 7 days, with: "Estimated from logged agent events with gaps capped at 5 minutes; overlapping sessions and machines count once. Includes overnight agents and laptop usage, not my hours at the keyboard." and the snapshot's time ("As of 26 Oct, 08:00 UTC."). It is read by the browser (ADR 0015) and shown only on the date in Rabat the snapshot was taken, since after midnight its month and week would describe other periods; hours are rounded only for display (whole hours from 10 up, one decimal below). A snapshot without hours, or with any hours value out of range, shows no block. The daily values are published but not drawn yet.

### What signals publishes

`GET /v1/llm-usage` (schema: `packages/contracts/schema/llm-usage.output.json`): the same totals; `days` sorted, one entry per date; `agents` with the source id replaced by its public label from `apps/signals/src/intake/public-labels.ts` (`claude` is "Claude Code", and so on), sorted by tokens, each with `tokenShare` of the month's total tokens. An agent id without a label is dropped, and the shares of the others are not scaled up to hide it. There is no timezone, machine, model, project or session field anywhere in the contract.

### Producer

`producers/llm-usage.ts`, run by a systemd user timer every 6 hours ([docs/producers/llm-usage.md](../producers/llm-usage.md)). It runs three commands, all with `--timezone Africa/Casablanca` and the same default scope (every source, every machine, no filter):
1. `llm-usage summary --timezone Africa/Casablanca --json`, first. Its `timezone` must be Africa/Casablanca and `activity.to` must be the reporting date when collection started; its window `activity.from`–`activity.to` fixes the dates of the other two.
2. `llm-usage daily --since <from> --until <to> --timezone Africa/Casablanca --json`, for the daily costs.
3. `llm-usage trends --metric active-hours --since <from> --until <to> --timezone Africa/Casablanca --json`, for the hours.

Each report must be `schemaVersion: 1` with the expected `report` name. The summary needs its activity window (one day per date, in order), `last7Days` and `monthToDate` periods inside it ending on `activity.to`, and whole non-negative token counts; the daily report one `period_combined` row at most per date inside the window. If either fails, no delivery is created (exit 65). The trends report must have `metric: "active-hours"`, a `combined` total series, the same date range, and exactly one bucket per date of the window, each a whole number of milliseconds from 0 to 25 hours. If it fails, or the command fails, every `activeMs` is left out and the tokens and costs are still sent. Days are joined by date, never by position, and the week and month totals are the sums of the buckets from each summary period's `since` to `until`; the series' own `summary` and the per-source series are never used.

The three commands are not one snapshot: the laptop can sync between them, and each report's numbers are sent as that report gave them. `sentAt` is the time collection started. If the reporting date changes during collection, the collection is discarded before it is persisted and run again for the new date (up to three times), so a delivery never mixes two days' periods.

Delivery (one run at a time, the pending body on disk, retries, credentials) follows ADR 0032, shared by both producers. `/v1/llm-usage` reports `stale: true` 2 days after the last `sentAt`.

## Consequences

A new llm-usage source shows up on the site only after its id gets a label in `public-labels.ts`. The producer owns the mapping from llm-usage's report JSON; when that JSON changes, the script changes, not this contract.
