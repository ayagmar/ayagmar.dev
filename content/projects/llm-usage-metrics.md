---

slug: llm-usage-metrics
tagline: 'Token and cost reports for AI coding agents, read from their local session logs.'
status: active
---

`llm-usage-metrics` is a command-line tool that reads the session logs AI coding tools leave on disk: Claude Code, Codex, Gemini CLI, OpenCode, Copilot, pi and others, 17 in all, on this machine and on others it reaches over ssh. It turns them into one usage history and reports tokens and estimated cost by day, hour, project or session.

Run with no command, `llm-usage` prints today, the last 7 days and the month so far, a month-end projection, what prompt caching saved, streaks and a year-long heatmap. Other reports compare periods, check usage against 5-hour plan windows and subscription prices, line usage up with Git activity, or open the numbers in an HTML report. It works offline with a bundled pricing snapshot and needs no configuration for a first report.

The LLM usage numbers on [/stats](/stats#llm-usage) come from it.
