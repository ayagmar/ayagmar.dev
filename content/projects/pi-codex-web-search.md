---

slug: pi-codex-web-search
tagline: 'A web_search tool for pi that runs through the Codex CLI you are already signed in to.'
status: maintained
group: agents
---

`pi-codex-web-search` registers a `web_search` tool in pi and answers it by running `codex exec` with web search turned on, read-only and in a throwaway session. There is no API key to manage: it uses the Codex login you already have.

A fast search uses Codex's indexed results, and a search that needs fresh pages crawls live. Codex returns structured JSON, and pi gets a short summary with numbered sources. While it runs, pi shows the queries Codex issued, a search budget and progress, and a run that goes quiet fails after 30 or 60 seconds instead of hanging. A request that is only a URL is read directly with Defuddle.

It is published on npm and needs pi 1.0 and Node.js 22.19 or newer.
