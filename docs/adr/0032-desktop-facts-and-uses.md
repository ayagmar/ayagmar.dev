# 0032. Desktop facts producer and /uses

Status: accepted, 2026-10-26

## Context

The owner wants a `/uses` page: the hardware and software they work with, plus a few live facts from the desktop (kernel, niri version, uptime) and the coding agents used this month. The llm-usage answer of 2026-10-26 recommended a separate producer for the desktop facts rather than adding them to the llm-usage push: they come from another source, change on another schedule, and a separate token limits what a leaked one can do. The owner decided that PC specs are static content they check by hand, not detected live, and that both the desktop and the laptop are listed. The desktop facts producer stays desktop-only.

Version strings look harmless but are free text: a custom kernel's `uname -r` can end in a user or host name, and a version command can print a path or a commit. ADR 0011 requires allowlists on values, not only keys.

## Decision

### The push: `POST /v1/push/desktop`

Same wire format and intake as ADR 0011 (content type, 64 KiB streamed cap, token, schema, delivery lookup, rate limiter, freshness, projection, atomic admission), with its own token: `PUSH_TOKEN_DESKTOP` and `PUSH_TOKEN_DESKTOP_NEXT`. No signature. Body (schema: `packages/contracts/schema/push-desktop.input.json`; examples: `packages/contracts/fixtures/desktop/push/`):

```json
{
  "producer": "desktop",
  "deliveryId": "5b0e2f6c-1d8a-4c3e-9f7b-2a6d4e8c1f03",
  "sentAt": "2026-10-26T08:00:00Z",
  "payload": { "kernel": "7.2.11-arch1-1", "niri": "26.04", "bootedAt": "2026-10-23T07:41:12.000Z" }
}
```

| Field      | Rule                                                                                                                                                                                                               | From                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| `kernel`   | null, or an official Arch kernel release, at most 48 characters: `linux` (`7.2.11-arch1-1`), `linux-lts` (`6.12.20-1-lts`), `linux-zen` (`6.13.7-zen1-1-zen`) or `linux-hardened` (`6.12.19-hardened1-1-hardened`) | `uname -r` (`os.release()`)                         |
| `niri`     | null, or a niri release number, at most 8 characters: `26.04`, `25.05.1`                                                                                                                                           | `niri --version`, without the commit in parentheses |
| `bootedAt` | UTC instant (`Z`, no offset), not before the Unix epoch and not after `sentAt`                                                                                                                                     | `btime` in `/proc/stat`                             |

The patterns are in `packages/contracts/src/desktop.ts`, a module without zod, so the contract, the `/uses` script and the producer's tests share one definition; the producer keeps a copy because it runs without the repo, and a test holds the copy equal. Anything else, a local build suffix, a path, a hash, whitespace or a control character, does not match. The producer sends null rather than the raw string, and signals answers 422 `invalid_payload` to a non-null value outside the pattern, so the whole push fails and nothing is stored. Unknown keys are stripped at every level, as everywhere in v1, and the projection (`apps/signals/src/intake/desktop.ts`) builds the snapshot field by field.

`bootedAt` not after `sentAt` and not before 1970 cannot be said in JSON Schema. signals checks it after the schema, through the producer's `check` in `handlePush`, and answers 422 `booted_at_out_of_range` with nothing stored. The producer checks it too and sends nothing when its clock puts the boot in the future.

The owner publishes these three values on purpose: the kernel and niri versions, and when the desktop last booted. `/v1/desktop` serves them with the usual envelope, and `staleAfterSeconds.desktop` is 2 days.

**Contracts.** `desktop` is a new source and a new producer within v1. Following ADR 0008, its envelope (`desktop`) and push body (`push-desktop`) are exported as their own schemas with their own corpus and frozen as first shipped (`test/frozen/v1/desktop.output.json`, `push-desktop.output.json`). The generic envelope gains the id in its `source` enum; its corpus and frozen file are unchanged.

### The producers' delivery, shared by llm-usage and desktop

Both producers live in `producers/` as TypeScript that Node 24 runs directly, with Node built-ins only, so the directory runs as installed without the repo: `delivery.ts` (shared), `desktop.ts`, `llm-usage.ts`. `samples.ts` writes invented readings for tests and dry runs. Their tests (`just test-producers`) run in CI's checks job. The guides in `docs/producers/` say how to install them; they are the code that runs.

A run, in `deliver()`:
1. **One at a time.** The script runs itself again under `flock` on `<state>/lock`; the kernel releases the lock when the process ends, crash included. A second run (timer, manual start) that finds it taken logs `busy` and exits 0, leaving the delivery to the first.
2. **Private state.** `$XDG_STATE_HOME/min7/<producer>/` (by default `~/.local/state/min7/<producer>/`), mode 0700, and `pending.json` mode 0600, reset on every run even if they already existed. Leftover temporary files from a crash are removed.
3. **Pending delivery.** If `pending.json` exists it must be a delivery of this producer (JSON, `producer`, a UUID `deliveryId`, a readable `sentAt`, a `payload` object); anything else fails closed with `pending_unreadable` and exit 78, and the file is left for the operator (recovery: look at it, then delete it). A readable one is resent with its exact bytes unless its `sentAt` is more than 23 hours old (signals refuses over 24), or, for desktop, its `bootedAt` is not the current boot; then it is retired, never resent with a new `sentAt`, and a new delivery is collected.
4. **Persist before sending.** A new body is written to a private temporary file, synced, renamed over `pending.json`, and the directory is synced, before the first attempt. A crash leaves the old complete body or the new one.
5. **Send.** `POST` with `redirect: 'manual'`, a 30 s timeout, and at most 4 KiB of the answer read. Only 200 or 202 with `{ "accepted": true }` counts as delivered; then `pending.json` is removed if it still holds this body. 409 and 422 are final for this body: it is removed, the error code is logged if it is a plain identifier, and the run exits 65. Network errors, 5xx, 429, and a 200 or 202 whose answer breaks off (connection lost or timed out while it is read, when signals may have stored the push) are retried with the same bytes and id up to five attempts with exponential backoff (5 s doubling, at most 2 minutes, with jitter), never sooner than `Retry-After`; when the attempts run out, or `Retry-After` asks for more than 5 minutes, the run exits 75 with the body kept. A `Retry-After` is also written to `<state>/retry-after` as an instant (at most 24 hours ahead), the same atomic way as the body, so it outlives the run: every later run, whether systemd's restart, the timer or a manual start, sends nothing before it. It waits out the rest if that is 5 minutes or less, and otherwise exits 75 again without a request. Any other answer clears it, and so does retiring the pending body. A file there that is not an instant fails closed with `retry_after_unreadable` (exit 78). Any other answer (401, 413, 415, a redirect, a 2xx whose complete answer is not the acknowledgement) keeps the body and exits 78 for the operator, without retrying.
6. **Logs.** One JSON line per event with fixed names, the producer, the delivery id, the attempt, the HTTP status and an allowlisted code. Never the token, a body, a header, or a collector's output or error.

The systemd service has `RestartForceExitStatus=75` and `RestartSec=15min`: a run that ends with 75 is started again in 15 minutes, apart from the timer's schedule. Exit 65 and 78 are not restarted.

**Credentials.** In production the token is read from the owner's private `~/.config/ayagmar.dev/signals.env` (`$XDG_CONFIG_HOME`), a `NAME=value` file: only the line `PUSH_TOKEN_DESKTOP` (or `PUSH_TOKEN_LLM_USAGE`) is read, the file must not be readable by group or others, and a missing or short value fails with `token_missing`. The value is never passed on a command line or printed.

**Modes.** Production takes no options: real readings, the real token and state, and the fixed endpoint `https://api.ayagmar.dev`. `--dry-run --fixtures <dir>` builds a body from fixture files and prints it; it reads no credential, state or host data and sends nothing (`just producers-dry-run`). A local run against `wrangler dev` needs a loopback `MIN7_TEST_ENDPOINT`, `MIN7_TEST_TOKEN`, `MIN7_STATE_DIR` and `--fixtures` together (`just producers-local`); without all four it refuses to start, so a test endpoint can never be used with the production token, state or readings.

### The desktop producer and its timer

`producers/desktop.ts` reads the kernel release, the first line of `niri --version` (stderr ignored, 10 s timeout) and `btime`. A value outside its pattern is sent as null. `niri --version` needs no session, so the producer runs before login or without a graphical environment.

`min7-push-desktop.timer` (`producers/systemd/`) starts the service 2 minutes after the user manager starts and daily (`OnCalendar=daily`, `Persistent=true`, up to 30 minutes of random delay). A user manager starts at login, not at boot: without lingering the first push after a reboot comes at login. A push at boot needs `loginctl enable-linger`, which is the owner's call and is not done here. There is no pacman hook: a root hook cannot rely on the user's manager or environment, and the daily push picks up a niri upgrade within a day. A kernel upgrade shows after the reboot that runs it.

### `/uses`

- **Static part.** `content/uses.json`, validated by `apps/site/src/data/uses.ts` (strict, so a typo fails the build): an intro, sections of named items (system, editor and terminal, agents), and each machine with its parts. The owner keeps the hardware by hand. A unit test fails if a value looks like a machine identifier (a UUID, a MAC, a device or mount path, a long serial-like token).
- **Live part, read by the browser** (ADR 0015). A panel, hidden in the HTML, holds two blocks, each hidden on its own: the desktop facts from `/v1/desktop` and "Agents this month" from `/v1/llm-usage` (`monthToDate.agents`, the labels signals already publishes; no second copy). The panel shows while one of them does. A build-time value would stay on the page until the next merge: "up 3 days" would grow wrong by the hour, and October's agents would still say "this month" in November.
- **When the desktop facts show.** The answer is `desktop`, version 1, `stale: false`; `fetchedAt` is at most 2 days before the browser's clock and at most 5 minutes after it; `bootedAt` is a UTC instant not after `fetchedAt` or now; each value is null or in its pattern. Freshness is worked out again on every check from `fetchedAt`, whatever `stale` said. Uptime is the time since `bootedAt`, rounded down ("under an hour", "5 hours", "3 days"), labelled "from the last reported boot", with "Reported 2 hours ago." under it: it says when the machine last booted by its last report, not that it is on now. A null value hides its row.
- **When the agents show.** Under the same rules as agent hours on `/stats` (ADR 0014): only on the date in Rabat the snapshot was taken, with "As of 26 Oct, 08:00 UTC.".
- **Refresh.** `src/lib/live.ts`: one request per endpoint at a time with a 5 s deadline, on load and then every 30 minutes while the tab is visible; no request from a hidden tab. Each block is checked again every minute and on `visibilitychange`, `focus` and `pageshow`, so it hides the moment it stops holding, after sleep or the back/forward cache too. A failed request keeps the last good answer, which is still dropped once it no longer holds.
- **Fixtures mode** (local builds, CI, public Previews): no endpoint attribute, no request, no live panel, and no sample shown as current.
- Values from signals are set with `textContent`. The page has no nav link yet; the orchestrator adds one with the navigation change.

## Consequences

- signals has eight push secrets; `PUSH_TOKEN_DESKTOP` and `PUSH_TOKEN_DESKTOP_NEXT` are in `secrets.required`, so a production deploy fails until both are set. They must be set before this change is deployed.
- `/uses` costs two Worker requests per visible tab every 30 minutes (ADR 0010).
- The /uses script, the /stats script and the chunk they share have measured allowances (ADR 0017); the home page loads none of them.
- Adding a kernel flavour or a niri version format means changing the pattern in `packages/contracts/src/desktop.ts`, the producer's copy and the corpus together.
- If the owner later wants hours at the keyboard, an idle signal from niri would go in this producer, as a new optional field.
