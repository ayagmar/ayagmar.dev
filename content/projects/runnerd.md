---

slug: runnerd
tagline: 'Self-hosted GitHub Actions runners, each job in a fresh container.'
status: active
---

`runnerd` runs ephemeral GitHub Actions runners on one Linux host. Every job gets a fresh container, and the repositories it serves share slots inside one memory budget, a systemd slice.

It records each job's memory and CPU use and sizes runner profiles from it, so the limits are not tuned by hand. Runners share a build cache that the default branch writes, a queued job says why it is waiting, and `runnerctl insights` reports slow and flaky jobs and what their minutes would have cost on GitHub-hosted runners. Runners are unprivileged containers under Sysbox, each with its own Docker Engine.

It is written in Rust and is in early development. It should serve private repositories only: on a public one, anyone who opens a pull request can run code on the host.
