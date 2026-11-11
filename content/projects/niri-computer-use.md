---

slug: niri-computer-use
tagline: 'An MCP server that lets coding agents see and drive a niri desktop, with a stop key they cannot press.'
status: active
group: desktop
---

`niri-computer-use` gives Claude Code, Codex, pi or any MCP client up to 22 tools for the [niri](https://github.com/niri-wm/niri) Wayland compositor: read the windows and workspaces, take and zoom screenshots, focus and launch apps, click, type, and press buttons by name where an app exposes them on the accessibility bus. It works on the real desktop, not a VM, through niri's own IPC.

The guardrails are a lease (one agent acts at a time), a stop key bound in niri that cancels the action and takes the lease back, no input while the screen is locked, a focus check before typing, a deny list of apps, and an audit log. None of that is a sandbox: with the lease, an agent can do anything you can with a mouse and keyboard.

It is written in Rust, released for x86_64 and aarch64 Linux and on crates.io, and needs niri 26.04.
