---

slug: kipple
tagline: 'Finds what dev tools and coding agents leave on disk, says what each thing is, and removes what is safe to.'
status: active
group: agents
---

`kipple` scans for what tools leave behind: build output, caches and the files coding agents like Claude Code, Codex, pi and Cursor keep. For each finding it explains what it is and what you lose by deleting it, and sorts it into Safe, Review or Protected.

`kipple clean` asks before it removes anything, can move files to the trash instead, and records every run in a history. A profile saves what you approved, so a later clean can run unattended within that scope.

It is a Rust command line and terminal UI for Linux, macOS and Windows. The read-only scan, the home screen and safe cleaning work; there is no release yet.
