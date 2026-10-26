import { env } from 'cloudflare:workers';
import { beforeEach, expect, it } from 'vitest';
import { admitPush, type PushAdmission } from '../src/storage/admission.ts';
import { clearState, deliveryRows, forgetLastPush, snapshotRow } from './helpers.ts';

beforeEach(clearState);

// The intake route looks a delivery id up before admitting it. Two requests can both pass
// that lookup; the batch alone must then keep the second from replacing the first.
const admission = (overrides: Partial<PushAdmission> = {}): PushAdmission => ({
  producer: 'llm-usage',
  source: 'llm-usage',
  deliveryId: crypto.randomUUID(),
  bodySha256: 'a'.repeat(64),
  snapshotJson: '{"first":true}',
  fetchedAt: new Date().toISOString(),
  receivedAt: Date.now(),
  minIntervalMs: 60_000,
  ...overrides,
});

it('refuses a recorded delivery id even when the caller skipped the lookup', async () => {
  const first = admission();
  expect(await admitPush(env.DB, first)).toEqual({ outcome: 'accepted' });
  await forgetLastPush('llm-usage');

  const reused = { ...first, bodySha256: 'b'.repeat(64), snapshotJson: '{"second":true}' };
  expect(await admitPush(env.DB, reused)).toEqual({ outcome: 'conflict' });
  expect(await admitPush(env.DB, { ...first })).toEqual({ outcome: 'duplicate' });

  expect((await snapshotRow('llm-usage'))?.json).toBe('{"first":true}');
  expect(await deliveryRows()).toHaveLength(1);
});
