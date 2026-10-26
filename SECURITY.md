# Security

Report a vulnerability privately through [GitHub's private vulnerability reporting](https://github.com/ayagmar/ayagmar.dev/security/advisories/new). Do not open a public issue.

Include what is affected (the site, the `api.ayagmar.dev` Worker, or a push contract), how to reproduce it, and what an attacker gains.

In scope: ayagmar.dev, api.ayagmar.dev, and the code in this repository. Project sites on other subdomains have their own repositories.

The site has no secrets and no user accounts. The signals Worker holds producer tokens and upstream API keys as Cloudflare secrets; none are stored in this repository.
