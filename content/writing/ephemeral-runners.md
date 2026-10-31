---

title: 'Placeholder: ephemeral CI runners on a home machine'
date: 2026-10-02
updated: 2026-10-12
summary: 'Placeholder draft for layout and tests. Fresh containers for every GitHub Actions job.'
tags: [rust, ci]
projects: [runnerd]
art: { kind: dither, palette: night }
draft: true
---

**This is a placeholder draft.** Production builds leave it out; the e2e tests read it on the build that shows drafts.

A self-hosted runner that keeps state between jobs leaks it between jobs. Starting each job in a fresh container trades a few seconds of startup for a clean machine every time.
