---

title: 'Placeholder: ephemeral CI runners on a home machine'
date: 2026-10-02
updated: 2026-10-12
summary: 'Placeholder post for layout and tests. Fresh containers for every GitHub Actions job.'
tags: [rust, ci]
---

**This is a placeholder post.** It will be replaced by real writing.

A self-hosted runner that keeps state between jobs leaks it between jobs. Starting each job in a fresh container trades a few seconds of startup for a clean machine every time.
