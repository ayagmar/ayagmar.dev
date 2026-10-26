# llm-usage producer

How the owner's machine pushes llm-usage-metrics totals and estimated agent hours to `POST /v1/push/llm-usage`. The contract is [ADR 0014](../adr/0014-llm-usage-push-contract.md); delivery, credentials and state are shared with the desktop producer and described in [ADR 0032](../adr/0032-desktop-facts-and-uses.md). The code that runs is `producers/llm-usage.ts` and `producers/delivery.ts` in this repo, tested by `just test-producers` in CI.

## What it runs

Three commands, all in Africa/Casablanca and with llm-usage's default scope (every source, every machine, the laptop included):

```sh
llm-usage summary --timezone Africa/Casablanca --json
llm-usage daily --since <activity.from> --until <activity.to> --timezone Africa/Casablanca --json
llm-usage trends --metric active-hours --since <activity.from> --until <activity.to> --timezone Africa/Casablanca --json
```

The summary runs first; its activity window sets the other two ranges. If trends fails or its answer does not check out, the push goes without agent hours. If the date in Rabat changes while the three run, the collection starts again.

## Prerequisites

- Node 24.2 or later, through mise's shim at `~/.local/share/mise/shims/node` (the units call it by that path).
- `llm-usage` 0.14 or later on the same `PATH` (mise's shims).
- `flock` (util-linux).
- `PUSH_TOKEN_LLM_USAGE=<token>` in `~/.config/ayagmar.dev/signals.env`, a file only its owner can read (mode 600). The producer reads that one line.

## Install

From a checkout of `main`:

```sh
install -d -m 700 ~/.local/lib/min7-producers
install -m 600 producers/delivery.ts producers/llm-usage.ts ~/.local/lib/min7-producers/
install -D -m 644 -t ~/.config/systemd/user producers/systemd/min7-push-llm-usage.service producers/systemd/min7-push-llm-usage.timer
systemctl --user daemon-reload
```

Check one run by hand, then turn on the timer:

```sh
systemctl --user start min7-push-llm-usage.service
journalctl --user -u min7-push-llm-usage.service -n 20 -o cat
systemctl --user enable --now min7-push-llm-usage.timer
```

A good run logs `{"producer":"llm-usage",...,"event":"delivered","status":202}`. The timer runs at 00:15, 06:15, 12:15 and 18:15 with up to 10 minutes of delay, and catches up after the machine was off (`Persistent=true`).

To update, repeat the `install` lines and `daemon-reload`.

## Without sending anything

```sh
just producers-dry-run                  # bodies from invented readings, printed; reads nothing real
just signals-dev                        # in another terminal, with .dev.vars filled in
just producers-local                    # both producers against the local Worker, fake tokens
```

## When something goes wrong

The journal has one JSON line per event; none holds the token, a body or llm-usage's output.

| Event and code                               | What it means and what to do                                                                                                                                    |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `retry_later` (exit 75)                      | Network, 5xx or 429 after five attempts, or `llm_usage_failed`. The body stays on disk; systemd runs the service again in 15 minutes.                           |
| `needs_operator` with a status (exit 78)     | 401 (token), 413, 415, a redirect, or an answer without `{"accepted": true}`. The body stays; fix the cause and start the service.                              |
| `refused` with a code (exit 65)              | 409 or 422: signals will never take this body. It is dropped; the next run collects a new one. A 422 `invalid_payload` means the mapping and contract disagree. |
| `failed` `summary_invalid` / `daily_invalid` | llm-usage's JSON changed. Nothing is sent; update `producers/llm-usage.ts`.                                                                                     |
| `failed` `pending_unreadable` (exit 78)      | `~/.local/state/min7/llm-usage/pending.json` is not a delivery. Look at it, then delete it; the next run collects a new one.                                    |
| `failed` `token_missing` / `credentials_*`   | The token line is missing or short, or `signals.env` is readable by others (`chmod 600`).                                                                       |
| `agent_hours_unavailable`                    | The push went without agent hours: trends failed or did not check out.                                                                                          |
| `busy`                                       | Another run holds the lock; it delivers.                                                                                                                        |
