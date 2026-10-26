# 0019. Security headers and Content-Security-Policy

Status: accepted, 2026-10-26

## Context

The site has no secrets, but it should not run scripts it did not ship, be framed, or leak referrers. Workers static assets apply a `_headers` file; responses from the site Worker need the same headers.

## Decision

`apps/site/scripts/postbuild.ts` runs after `astro build` and `pagefind`. It hashes (sha256) the content of every inline `<script>` and `<style>` in `dist/**/*.html`, builds one policy from `src/lib/security-headers.ts`, and writes `dist/_headers` for `/*`:
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

## Consequences

An inline script or style added later gets hashed automatically. A `style=""` attribute, an inline event handler or a third-party origin fails the e2e suite until the policy is changed here.
