# 0014. llm-usage push contract

Status: accepted, 2026-10-26

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
| `days`                        | at most 371 (53 weeks), `date` `YYYY-MM-DD`, cost and tokens per day     | `daily --since <from>`: rows with `source: "combined"`        |

Null costs stay null. A guessed 0 would show a free month. Size cap 64 KiB; a full year is about 25 KiB.

### What signals publishes

`GET /v1/llm-usage` (schema: `packages/contracts/schema/llm-usage.output.json`): the same totals; `days` sorted, one entry per date; `agents` with the source id replaced by its public label from `apps/signals/src/intake/public-labels.ts` (`claude` is "Claude Code", and so on), sorted by tokens, each with `tokenShare` of the month's total tokens. An agent id without a label is dropped, and the shares of the others are not scaled up to hide it. There is no timezone, machine, model, project or session field anywhere in the contract.

### Producer

A timer on the owner's machine runs the two `llm-usage` commands, maps the output, and pushes. [docs/producers/llm-usage.md](../producers/llm-usage.md) has an example script and systemd units. It keeps the body of an undelivered push on disk, so a retry sends the same `deliveryId` and bytes, retries on network errors, 5xx and 429, and drops the body on any other answer. The script runs every 6 hours; `/v1/llm-usage` reports `stale: true` 2 days after the last `sentAt`.

## Consequences

A new llm-usage source shows up on the site only after its id gets a label in `public-labels.ts`. The producer owns the mapping from llm-usage's report JSON; when that JSON changes, the script changes, not this contract.
