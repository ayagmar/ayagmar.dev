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

  // Catches the policy loosening beyond the one frame comments need (ADR 0036).
  it('allows framing giscus.app and nothing else', () => {
    const csp = contentSecurityPolicy({ scripts: [], styles: [] });
    expect(csp).toContain('frame-src https://giscus.app;');
    expect(csp.match(/giscus/g)).toHaveLength(1);
    expect(csp).toContain("default-src 'none'");
  });
});
