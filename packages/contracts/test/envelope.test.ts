import { describe, expect, it } from 'vitest';
import { anyEnvelopeSchema, isStale } from '../src/index.ts';

describe('isStale', () => {
  const now = new Date('2026-10-26T12:00:00Z');

  it('is stale when the source never succeeded', () => {
    expect(isStale(null, 60, now)).toBe(true);
  });

  it('is fresh up to and including the threshold, stale after it', () => {
    expect(isStale('2026-10-26T11:59:00Z', 60, now)).toBe(false);
    expect(isStale('2026-10-26T11:58:59Z', 60, now)).toBe(true);
  });

  it('compares instants, not local wall-clock strings', () => {
    expect(isStale('2026-10-26T13:59:30+02:00', 60, now)).toBe(false);
  });

  it('treats an unreadable timestamp as stale', () => {
    expect(isStale('yesterday', 60, now)).toBe(true);
  });
});

describe('envelope', () => {
  const base = { source: 'listening', version: 1, fetchedAt: null, stale: true, data: null };

  it('accepts a source that never succeeded', () => {
    expect(anyEnvelopeSchema.safeParse(base).success).toBe(true);
  });

  it('rejects timestamps that are not RFC 3339 and unknown sources', () => {
    expect(anyEnvelopeSchema.safeParse({ ...base, fetchedAt: '2026-10-26 12:00' }).success).toBe(
      false
    );
    expect(anyEnvelopeSchema.safeParse({ ...base, source: 'rainfall' }).success).toBe(false);
  });

  it('ignores fields added later within v1', () => {
    const parsed = anyEnvelopeSchema.parse({ ...base, servedBy: 'edge' });
    expect(parsed).toEqual(base);
  });
});
