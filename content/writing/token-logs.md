---

title: 'Placeholder: what 17 coding agents taught me about token logs'
date: 2026-10-20
summary: 'Placeholder post for layout and tests. Session logs, <usage> blocks & the cost of caching.'
tags: [llm, tooling]
projects: [llm-usage-metrics]
---

**This is a placeholder post.** It exists so the site has something to render, index and put in the feeds. It will be replaced by real writing.

Every coding agent writes its session log differently. Some record a `usage` object per message, some only per session, and a few never record cache reads at all.

```sh
llm-usage --json --since 2026-10-01
```

| Agent       | Log format             |
| ----------- | ---------------------- |
| Claude Code | JSON lines per message |
| Codex       | JSON lines per turn    |
