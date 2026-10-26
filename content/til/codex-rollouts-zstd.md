---

title: Codex can write its session logs as .jsonl.zst
date: 2026-10-21
tags: [codex, zstd]
---

A Codex session log, which it calls a rollout, may be a plain `.jsonl` file or a zstd-compressed `.jsonl.zst` one. A reader built for the plain files has to learn the compressed ones too, or those sessions drop out of its totals.

llm-usage-metrics reads both since 0.13.0. A compressed rollout that has data after its first zstd frame is reported as an error rather than read as far as it parses.
