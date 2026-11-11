---

slug: pi-mobile
tagline: 'An Android app for steering the pi coding sessions running on your laptop.'
status: maintained
group: agents
---

`pi-mobile` is an Android client for the [pi](https://github.com/earendil-works/pi) coding agent. Pi keeps running on the laptop; the phone browses its sessions, resumes one, and sends prompts, steers or aborts the agent while its thinking and tool calls stream in.

A small Node.js bridge on the laptop turns the app's WebSocket into pi's JSON-lines RPC over stdin and stdout, starting a pi process per working directory. The phone reaches the bridge over Tailscale with a token, so no port has to be forwarded. The app also runs shell commands, attaches images, walks and forks the session tree, picks models and shares a session through a link that can be revoked.

It is written in Kotlin. There is no published release: you build the APK from the repository and install it with `adb`.
