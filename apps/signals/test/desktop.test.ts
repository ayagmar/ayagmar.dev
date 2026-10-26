// The desktop facts push (ADR 0032) through the shared intake: its own token, value allowlists,
// and a boot time that must not be later than the snapshot it came in.
import { env } from 'cloudflare:workers';
import { pushFixtures, snapshotFixtures } from '@min7/contracts/fixtures';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearState,
  delivery,
  deliveryRows,
  fetchApi,
  forgetLastPush,
  push,
  snapshotRow,
} from './helpers.ts';

const { ok, minimal, 'sensitive-fields': sensitive } = pushFixtures.desktop;

beforeEach(clearState);

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

/** The ok facts, sent now, with `payload` fields replaced. */
const facts = (payload: object, overrides: object = {}) =>
  delivery(ok, { payload: { ...ok.payload, ...payload }, ...overrides });

// Catches the new source not being wired through to its read endpoint.
it('stores the facts and serves them on /v1/desktop with the producer time as fetchedAt', async () => {
  const sentAt = minutesAgo(1);
  expect((await push('desktop', delivery(ok, { sentAt }))).status).toBe(202);

  expect(await fetchApi('/v1/desktop').then((r) => r.json())).toEqual({
    source: 'desktop',
    version: 1,
    fetchedAt: sentAt,
    stale: false,
    data: snapshotFixtures.desktop.ok,
  });
});

// Catches an unrecognised kernel or niri version being stored as an empty string or 0.
it('serves facts the producer could not read as null', async () => {
  expect((await push('desktop', delivery(minimal, { sentAt: minutesAgo(1) }))).status).toBe(202);
  expect((await fetchApi('/v1/desktop').then((r) => r.json<{ data: unknown }>())).data).toEqual(
    snapshotFixtures.desktop.minimal
  );
});

describe('values outside the allowlists', () => {
  // A permitted field holding a private-looking string must fail as a whole: there is no
  // partial acceptance that could keep the rest and publish a fallback.
  it.each([
    ['a kernel with a local suffix', { kernel: '7.2.11-arch1-1-owner-private-host' }],
    ['a niri version with a commit', { niri: '26.04 (8ed0da4)' }],
    ['a path as the kernel', { kernel: '/home/x/vmlinuz' }],
  ])('rejects %s with 422 and stores nothing', async (_case, payload) => {
    const response = await push('desktop', facts(payload));
    const text = await response.text();

    expect(response.status).toBe(422);
    expect(JSON.parse(text).error).toBe('invalid_payload');
    expect(text).not.toMatch(/owner-private-host|8ed0da4|home/);
    expect(await deliveryRows()).toEqual([]);
    expect(await snapshotRow('desktop')).toBeNull();
  });

  // Catches an unknown or private field reaching D1 or the read API.
  it('strips unknown fields at every level', async () => {
    expect((await push('desktop', delivery(sensitive))).status).toBe(202);

    const stored = (await snapshotRow('desktop'))?.json ?? '';
    const served = await fetchApi('/v1/desktop').then((r) => r.text());
    for (const text of [
      'workstation',
      'owner-private-host',
      'ayagmar-secret',
      '0f1e2d3c4b5a',
      '/home/x',
      'SERIAL-ABC123',
      '8ed0da4',
      'UUID=',
      'nvme0n1',
    ]) {
      expect(stored).not.toContain(text);
      expect(served).not.toContain(text);
    }
    expect(JSON.parse(stored)).toEqual(snapshotFixtures.desktop['sensitive-fields']);
  });
});

describe('boot time', () => {
  // Catches a future boot time published as a negative or zero uptime.
  it.each([
    ['after the snapshot was taken', minutesAgo(1), minutesAgo(2)],
    ['before the Unix epoch', '1969-12-31T23:59:59.000Z', minutesAgo(1)],
  ])('rejects a boot %s with 422 and stores nothing', async (_case, bootedAt, sentAt) => {
    const response = await push('desktop', facts({ bootedAt }, { sentAt }));

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: 'booted_at_out_of_range' });
    expect(await deliveryRows()).toEqual([]);
    expect(await snapshotRow('desktop')).toBeNull();
  });

  // The boundary: a snapshot taken in the second the machine booted is consistent.
  it('accepts a boot time equal to sentAt', async () => {
    const at = minutesAgo(1);
    expect((await push('desktop', facts({ bootedAt: at }, { sentAt: at }))).status).toBe(202);
  });
});

describe('credentials', () => {
  // Catches a token being accepted on another producer's route, in either direction.
  it.each([
    [
      'the llm-usage token',
      () => push('desktop', delivery(ok), { token: env.PUSH_TOKEN_LLM_USAGE }),
    ],
    ['the trellis token', () => push('desktop', delivery(ok), { token: env.PUSH_TOKEN_TRELLIS })],
    [
      'the desktop token on the llm-usage route',
      () =>
        push('llm-usage', delivery(pushFixtures['llm-usage'].minimal), {
          token: env.PUSH_TOKEN_DESKTOP,
        }),
    ],
  ])('rejects %s with a bare 401', async (_case, send) => {
    const response = await send();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
    expect(await deliveryRows()).toEqual([]);
  });

  it('accepts the next token during a rotation', async () => {
    const response = await push('desktop', delivery(ok), { token: env.PUSH_TOKEN_DESKTOP_NEXT });
    expect(response.status).toBe(202);
  });

  // Catches a desktop body admitted on another route that happens to authenticate.
  it('rejects a desktop body on the llm-usage route', async () => {
    const response = await push('llm-usage', delivery(ok));
    expect(response.status).toBe(422);
    expect(await snapshotRow('llm-usage')).toBeNull();
  });
});

describe('delivery', () => {
  // Catches a restarted producer's resend being stored twice or refused.
  it('answers a resend of the same bytes with 200 and changes nothing', async () => {
    const body = delivery(ok, { sentAt: minutesAgo(1) });
    expect((await push('desktop', body)).status).toBe(202);
    await forgetLastPush('desktop');

    expect((await push('desktop', body)).status).toBe(200);
    expect(await deliveryRows()).toHaveLength(1);
  });

  it('rejects a body over 64 KiB with 413', async () => {
    const body = facts({}, { padding: 'x'.repeat(64 * 1024) });
    expect((await push('desktop', body)).status).toBe(413);
    expect(await deliveryRows()).toEqual([]);
  });
});
