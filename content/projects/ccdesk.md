---

slug: ccdesk
tagline: 'Shows everything Claude Code loads in a directory, and which file each piece comes from.'
status: active
group: agents
---

Claude Code reads its instructions, settings, permissions, hooks, MCP servers, subagents, skills, plugins and memory from files at six scopes. `npx ccdesk` opens a page in the browser for the directory you ran it in, lists everything that applies there in the order Claude Code loads it, and names the file behind each piece. It answers questions like why Claude asks before every `git push` here, or which file set this repository's model.

You can fix things on the same page. Each change shows its diff before it is saved, the old file is backed up, and every edit can be undone. The command line has `scan`, `check` for CI, `compare` for two directories and `rules --suggest`, which proposes allow rules from the calls you approved by hand.

It runs on `127.0.0.1` behind a token, never reads Claude Code's credentials, and hides secret values in settings and MCP server arguments. It needs Node.js 22.19 or newer.
