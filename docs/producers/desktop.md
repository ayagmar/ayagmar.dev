# Desktop facts producer

How the owner's desktop pushes its kernel release, niri version and boot time to `POST /v1/push/desktop` for `/uses`. The contract and the delivery rules are in [ADR 0032](../adr/0032-desktop-facts-and-uses.md). The code that runs is `producers/desktop.ts` and `producers/delivery.ts` in this repo, tested by `just test-producers` in CI. It runs on the desktop only; the laptop has no producer.

## What it reads

- `uname -r` (Node's `os.release()`): sent only if it is an official Arch kernel release (`7.2.11-arch1-1`, `6.12.20-1-lts`, `…-zen1-1-zen`, `…-hardened1-1-hardened`), else null.
- The first line of `niri --version`: the release number only (`26.04`), never the commit; null for anything else or if niri cannot run.
- `btime` from `/proc/stat`, as a UTC instant. The site works out uptime from it.

Nothing else: no hostname, user, hardware, serial, path or session variable.

## Prerequisites

- Node 24.2 or later, through mise's shim at `~/.local/share/mise/shims/node` (the unit calls it by that path).
- niri in `/usr/bin`. It does not need a running session.
- `flock` (util-linux).
- `PUSH_TOKEN_DESKTOP=<token>` in `~/.config/ayagmar.dev/signals.env`, a file only its owner can read (mode 600). The producer reads that one line.

## Install

From a checkout of `main`, after signals has `PUSH_TOKEN_DESKTOP` and `PUSH_TOKEN_DESKTOP_NEXT` (docs/operations.md):

```sh
install -d -m 700 ~/.local/lib/min7-producers
install -m 600 producers/delivery.ts producers/desktop.ts ~/.local/lib/min7-producers/
install -D -m 644 -t ~/.config/systemd/user producers/systemd/min7-push-desktop.service producers/systemd/min7-push-desktop.timer
systemctl --user daemon-reload
```

Check one run by hand, then turn on the timer:

```sh
systemctl --user start min7-push-desktop.service
journalctl --user -u min7-push-desktop.service -n 20 -o cat
systemctl --user enable --now min7-push-desktop.timer
```

A good run logs `{"producer":"desktop",...,"event":"delivered","status":202}`, and `https://api.ayagmar.dev/v1/desktop` then shows the three values.

The timer runs 2 minutes after the user manager starts, and daily. The user manager starts at login, so after a reboot the first push comes at login. A push before login needs lingering, `loginctl enable-linger "$USER"`, which keeps the user's services running without a session; it is optional and not part of this setup.

To update, repeat the `install` lines and `daemon-reload`.

## Behaviour worth knowing

- A pending push from before a reboot is never sent: its boot time is no longer the current one, so it is retired and a new one collected.
- A pending push older than 23 hours is rebuilt with a new id.
- After a pacman upgrade of niri, the next daily push carries the new version. A new kernel shows after the reboot into it.
- The journal's events and codes are the same as the llm-usage producer's ([llm-usage.md](llm-usage.md#when-something-goes-wrong)). `boot_time_in_future` means the clock is wrong; nothing is sent.

## Without sending anything

```sh
just producers-dry-run      # bodies from invented readings, printed; reads nothing real
just producers-local        # against `just signals-dev`, with the fake tokens in .dev.vars
```
