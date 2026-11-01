# 0019. Security headers and Content-Security-Policy

Status: accepted, 2026-10-26. Amended 2026-11-01: the owner approved Cloudflare Web Analytics, so a production build's policy allows its beacon and its reports (see Amendments). Amended 2026-11-01: JSON-LD blocks need no hash but must parse.

## Context

The site has no secrets, but it should not run scripts it did not ship, be framed, or leak referrers. Workers static assets apply a `_headers` file; responses from the site Worker need the same headers.

## Decision

`apps/site/scripts/postbuild.ts` runs after `astro build` and `pagefind`. It reads every inline `<script>` and `<style>` in `dist/**/*.html`. An inline element is allowed only when its content is exactly one of Astro's own: the island runtime, a hydration directive (`idle`, `load`, `media`, `only`, `visible`) or the island style, compared against the strings in the installed `astro` package. Allowed ones are hashed (sha256). Any other inline script or style, such as raw HTML in a Markdown post, fails the build with the page named, so content can never widen the policy. The script then builds one policy from `src/lib/security-headers.ts` and writes `dist/_headers` for `/*`:
- `Content-Security-Policy`: `default-src 'none'`; `script-src 'self' 'wasm-unsafe-eval'` plus the hashes; `style-src 'self'` plus the hashes; `img-src`, `font-src`, `manifest-src` and `form-action` `'self'`; `connect-src 'self' https://api.ayagmar.dev`; `worker-src 'self'`; `base-uri 'none'`; `object-src 'none'`; `frame-ancestors 'none'`. No `unsafe-inline`.
- `Strict-Transport-Security: max-age=63072000; includeSubDomains` (no `preload`: that commits the domain to browser preload lists and is the owner's call).
- `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` denying sensors, camera, microphone, geolocation, payment and USB, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy: same-origin`.
- `/_astro/*` (hashed file names) is cached for a year, immutable.

Details:
- The inline scripts are Astro's island runtime and its `client:idle` loader; the inline style is Astro's `astro-island { display: contents }`. Everything else is an external file.
- Pagefind compiles WebAssembly (`'wasm-unsafe-eval'`) and runs its search in a same-origin worker, `/pagefind/pagefind-worker.js`, allowed by `worker-src 'self'`. The worker script is served with the same policy.
- The policy is delivered only as a header, never as a `<meta>` tag, so there is exactly one policy. Astro's built-in `security.csp` was not used: it writes a per-page meta policy whose hashes differ from page to page.
- `renderHeadersFile` throws if any `_headers` line reaches 2000 characters, the limit Cloudflare applies; a unit test covers it.
- The site Worker fetches both the HTML and `index.txt` through the `ASSETS` binding, which applies `_headers`, so its responses carry the same headers (verified against `wrangler dev`).
- Shiki is off because its `style=""` attributes violate `style-src` (ADR 0004).

Playwright runs every page against `wrangler dev` and fails on any `securitypolicyviolation` event or CSP console error, and asserts the headers on HTML, `index.txt`, a 404 and the terminal response.

## Amendment, 2026-11-01: structured data

Structured data (`<script type="application/ld+json">`, docs/seo.md) is data a browser never runs, so `script-src` does not apply and it needs no hash. `postbuild.ts` accepts such a block only if its body parses as JSON, and fails the build otherwise. Its text escapes `<`, so a title cannot end the element.

## Amendment, 2026-11-01: Cloudflare Web Analytics

The owner wants visit counts and approved Cloudflare Web Analytics for them: Cloudflare's own beacon, which sets no cookies and no local storage, on a site Cloudflare already serves. Its automatic injection never reached the HTML the Worker serves, so the page includes the beacon itself.

- Only production gets it: `Base.astro` renders `<script type="module" src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token":…}'>` when Workers Builds builds `main` (`WORKERS_CI_BRANCH`) and the token in `src/lib/search.ts` is set. The token is public. Previews, local builds and the e2e builds have no beacon and count nothing.
- `postbuild.ts` adds `https://static.cloudflareinsights.com` to `script-src` and `https://cloudflareinsights.com` (where the beacon posts its report) to `connect-src` only when a built page loads that exact script, so every other build keeps the policy above. No `unsafe-inline`: the beacon is an external file, and its settings are a data attribute.
- ADR 0017's budget allows the beacon by its exact URL, and only as a `<script src>`.

## Consequences

An Astro upgrade that changes its inline runtime is picked up from the package automatically. An inline script or style from anywhere else fails the build. A `style=""` attribute, an inline event handler or a third-party origin fails the e2e suite until the policy is changed here.
