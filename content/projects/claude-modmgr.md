---

slug: claude-modmgr
tagline: 'A /mods dialog in Claude Code that finds plugins and says what each can reach before it runs.'
status: active
group: agents
---

Claude Code plugins can run programs, read the conversation and change what the model sees, and thousands are spread across GitHub with nowhere to search them. modmgr adds `/mods` to the session: it searches the marketplaces you added and the community plugins found on public GitHub, from indexes its CI rebuilds daily.

Before an install, it shows what a plugin can touch, from `claude plugin validate` reading the source without running it, with risky combinations called out, such as reading files and sending data out. Every install is reviewed, a command a marketplace declares runs only after you confirm it by its sha256, and an update that adds something notable says so. Changes are staged, applied with one reload and can be undone.

It installs from the `ayagmar/claude-mods` marketplace and runs on Linux and macOS.
