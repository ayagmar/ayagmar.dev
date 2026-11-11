---

slug: repo-pulse
tagline: 'Posts GitHub stars, issues, pull requests, pushes and releases to Discord, and keeps a record of each.'
status: active
group: self-hosted
---

`repo-pulse` is a Cloudflare Worker with a D1 database that you run on your own account. GitHub sends it webhooks and it posts to a Discord channel: stars, forks, issues, pull requests, pushes to the default branch and releases.

It decides what is worth a message. Pushes from bots and merge commits of pull requests already announced are skipped, star milestones and sudden bursts of stars get their own alert, and each morning a digest sums up the day and lists the issues and pull requests waiting on a reply from you. Failed sends are retried with Discord's rate limits, redelivered events are not posted twice, and every delivery is stored and can be retried from an admin API.

It also serves the public activity feed this site reads: the shipping log and star counts on [/stats](/stats) come from it.
