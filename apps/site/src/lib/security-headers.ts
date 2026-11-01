import { comments } from './site.ts';

/** Sources the site may load from besides itself: the signals read API, and giscus's frame. */
const apiOrigin = 'https://api.ayagmar.dev';

/**
 * The site's Content-Security-Policy. Inline scripts and styles Astro emits are allowed by
 * hash only; 'wasm-unsafe-eval' lets Pagefind compile its WebAssembly, and its search runs in
 * a same-origin worker (`/pagefind/pagefind-worker.js`).
 */
export function contentSecurityPolicy(hashes: { scripts: string[]; styles: string[] }): string {
  const quoted = (list: string[]) => list.map((hash) => `'${hash}'`);
  return [
    "default-src 'none'",
    ["script-src 'self' 'wasm-unsafe-eval'", ...quoted(hashes.scripts)].join(' '),
    ["style-src 'self'", ...quoted(hashes.styles)].join(' '),
    "img-src 'self'",
    "font-src 'self'",
    `connect-src 'self' ${apiOrigin}`,
    `frame-src ${comments.origin}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "form-action 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** Headers every response of the site carries, HTML or not. */
export function securityHeaders(csp: string): Record<string, string> {
  return {
    'Content-Security-Policy': csp,
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy':
      'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Opener-Policy': 'same-origin',
  };
}

/** Cloudflare drops `_headers` lines of 2000 characters or more. */
export const maxHeaderLine = 2000;

/** The `_headers` file for Workers static assets. */
export function renderHeadersFile(headers: Record<string, string>): string {
  const lines = [
    '/*',
    ...Object.entries(headers).map(([name, value]) => `  ${name}: ${value}`),
    '/_astro/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    // Fixed names that crawlers and browsers ask for (src/lib/og.ts): a day, then revalidate.
    ...['/og/*', '/favicon.ico', '/favicon.svg', '/apple-touch-icon.png'].flatMap((path) => [
      path,
      '  Cache-Control: public, max-age=86400',
    ]),
    '',
  ];
  const tooLong = lines.find((line) => line.length >= maxHeaderLine);
  if (tooLong !== undefined) {
    throw new Error(`_headers line is ${tooLong.length} characters: ${tooLong.slice(0, 80)}...`);
  }
  return lines.join('\n');
}
