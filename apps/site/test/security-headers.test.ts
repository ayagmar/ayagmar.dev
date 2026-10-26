import { describe, expect, it } from 'vitest';
import {
  contentSecurityPolicy,
  maxHeaderLine,
  renderHeadersFile,
  securityHeaders,
} from '../src/lib/security-headers.ts';

describe('_headers', () => {
  it('refuses to write a line Cloudflare would drop', () => {
    const hashes = Array.from({ length: 40 }, (_, i) => `sha256-${String(i).padStart(44, 'x')}`);
    const csp = contentSecurityPolicy({ scripts: hashes, styles: [] });
    expect(csp.length).toBeGreaterThan(maxHeaderLine);
    expect(() => renderHeadersFile(securityHeaders(csp))).toThrow(
      /_headers line is \d+ characters/
    );
  });

  it('never allows inline scripts by keyword', () => {
    const csp = contentSecurityPolicy({ scripts: ['sha256-abc'], styles: ['sha256-def'] });
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval' 'sha256-abc'");
  });
});
