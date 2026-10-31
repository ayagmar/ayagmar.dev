---

title: 'Placeholder: counting cache reads that agents never log'
date: 2026-10-24
summary: 'Placeholder draft for layout and tests. Estimating cached tokens when the log leaves them out.'
tags: [llm]
projects: [llm-usage-metrics]
art: { kind: pattern, palette: zellige, seed: 3 }
draft: true
---

**This is a placeholder draft.** Production builds leave it out; the e2e tests read it on the build that shows drafts.

Some agents report cache reads per message, others fold them into the input count, and a few drop them. A usage report has to say which numbers it measured and which it estimated.
