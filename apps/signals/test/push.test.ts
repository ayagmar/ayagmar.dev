import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { pushFixtures, snapshotFixtures } from '@min7/contracts/fixtures';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/app.ts';
import { runScheduled } from '../src/cron/run.ts';
import {
  clearState,
  delivery,
  deliveryRows,
  fetchApi,
  forgetLastPush,
  nowSeconds,
  push,
  sign,
  snapshotRow,
} from './helpers.ts';

const {
  minimal: llmUsageMinimal,
  ok: llmUsageOk,
  'sensitive-fields': llmUsageSensitive,
} = pushFixtures['llm-usage'];
const { ok: trellisOk, 'sensitive-fields': trellisSensitive } = pushFixtures.trellis;
const { ok: llmUsageSnapshotOk, 'sensitive-fields': llmUsageSnapshotSensitive } =
  snapshotFixtures['llm-usage'];
const shelfSnapshotSensitive = snapshotFixtures.shelf['sensitive-fields'];

beforeEach(clearState);

const served = async (source: string) =>
  (await fetchApi(`/v1/${source}`)).json<{ data: unknown }>();

describe('accepting a push', () => {
  it('stores the allowlisted snapshot and serves it with the producer time as fetchedAt', async () => {
    const sentAt = new Date(Date.now() - 60_000).toISOString();
    const response = await push('llm-usage', delivery(llmUsageOk, { sentAt }));

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ accepted: true });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await fetchApi('/v1/llm-usage').then((r) => r.json())).toEqual({
      source: 'llm-usage',
      version: 1,
      fetchedAt: sentAt,
      stale: false,
      data: llmUsageSnapshotOk,
    });
  });
});

describe('authentication', () => {
  const body = delivery(llmUsageMinimal);
  const rejected = [
    ['no token', () => push('llm-usage', body, { token: null })],
    ['a wrong token', () => push('llm-usage', body, { token: 'x'.repeat(40) })],
    ['the trellis token', () => push('llm-usage', body, { token: env.PUSH_TOKEN_TRELLIS })],
    [
      'the llm-usage token on the trellis route',
      () => push('trellis', delivery(trellisOk), { token: env.PUSH_TOKEN_LLM_USAGE }),
    ],
    [
      'a token in the wrong scheme',
      () =>
        push('llm-usage', body, {
          token: null,
          headers: { Authorization: `Basic ${env.PUSH_TOKEN_LLM_USAGE}` },
        }),
    ],
  ] as const;

  it.each(rejected)('rejects %s with a bare 401 and stores nothing', async (_case, send) => {
    const response = await send();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
    expect(await deliveryRows()).toEqual([]);
    expect(await snapshotRow('llm-usage')).toBeNull();
    expect(await snapshotRow('shelf')).toBeNull();
  });

  it('accepts the next token and the next signing key during a rotation', async () => {
    expect((await push('llm-usage', body, { token: env.PUSH_TOKEN_LLM_USAGE_NEXT })).status).toBe(
      202
    );
    expect(
      (
        await push('trellis', delivery(trellisOk), {
          token: env.PUSH_TOKEN_TRELLIS_NEXT,
          hmacKey: env.PUSH_HMAC_TRELLIS_NEXT,
        })
      ).status
    ).toBe(202);
  });

  describe('with secret slots unset', () => {
    // Production requires all six secrets, but a Preview or a half-done setup may lack some.
    const send = async (producer: 'llm-usage' | 'trellis', token: string, slots: object) => {
      const body = delivery(producer === 'trellis' ? trellisOk : llmUsageMinimal);
      const timestamp = nowSeconds();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Min7-Timestamp': timestamp,
        'X-Min7-Signature': await sign(body, timestamp),
      };
      const ctx = createExecutionContext();
      const response = await app.fetch(
        new Request(`https://api.ayagmar.dev/v1/push/${producer}`, {
          method: 'POST',
          headers,
          body,
        }),
        { ...env, ...slots },
        ctx
      );
      await waitOnExecutionContext(ctx);
      return response.status;
    };

    it('accepts the current token and key without next slots', async () => {
      const unset = { PUSH_TOKEN_TRELLIS_NEXT: undefined, PUSH_HMAC_TRELLIS_NEXT: undefined };
      expect(await send('trellis', env.PUSH_TOKEN_TRELLIS, unset)).toBe(202);
    });

    it('accepts the next token without a current one', async () => {
      const unset = { PUSH_TOKEN_LLM_USAGE: undefined };
      expect(await send('llm-usage', env.PUSH_TOKEN_LLM_USAGE_NEXT, unset)).toBe(202);
    });

    it.each([undefined, '', 42])('answers 401 when no slot is usable (%s)', async (value) => {
      const tokens = { PUSH_TOKEN_LLM_USAGE: value, PUSH_TOKEN_LLM_USAGE_NEXT: value };
      const keys = { PUSH_HMAC_TRELLIS: value, PUSH_HMAC_TRELLIS_NEXT: value };
      expect(await send('llm-usage', String(value), tokens)).toBe(401);
      expect(await send('trellis', env.PUSH_TOKEN_TRELLIS, keys)).toBe(401);
    });
  });

  describe('trellis signature', () => {
    const signed = delivery(trellisOk);
    const cases = [
      ['no signature', { signature: '' }],
      ['a signature by another key', { hmacKey: 'k'.repeat(40) }],
      ['a signature of another body', { signature: 'pending' }],
      ['a timestamp 301 s in the past', { skewSeconds: -301 }],
      ['a timestamp 301 s ahead', { skewSeconds: 301 }],
      ['a timestamp that is not a number', { timestamp: '1e9' }],
    ] as const;

    it.each(cases)('rejects %s with a bare 401', async (_case, options) => {
      const signature =
        'signature' in options && options.signature === 'pending'
          ? await sign(delivery(trellisOk), nowSeconds())
          : undefined;
      // Skewed from the clock when the test runs, not when the cases were collected.
      const timestamp =
        'skewSeconds' in options ? String(Number(nowSeconds()) + options.skewSeconds) : undefined;
      const response = await push('trellis', signed, {
        ...options,
        ...(signature ? { signature } : {}),
        ...(timestamp ? { timestamp } : {}),
      });

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: 'unauthorized' });
      expect(await deliveryRows()).toEqual([]);
    });

    it('accepts a timestamp 299 s old', async () => {
      const timestamp = String(Number(nowSeconds()) - 299);
      expect((await push('trellis', signed, { timestamp })).status).toBe(202);
    });
  });

  it('asks the rate limiter only after authentication, and stops at its answer', async () => {
    const limit = vi.spyOn(env.PUSH_RATE_LIMIT, 'limit');
    await push('llm-usage', body, { token: null });
    expect(limit).not.toHaveBeenCalled();

    limit.mockResolvedValueOnce({ success: false });
    const response = await push('llm-usage', body);

    expect(limit).toHaveBeenCalledWith({ key: 'llm-usage' });
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: 'rate_limited' });
    expect(response.headers.get('retry-after')).toBe('60');
    expect(await deliveryRows()).toEqual([]);
    limit.mockRestore();
  });
});

describe('body limits and parsing', () => {
  // Valid deliveries padded with an unknown field to an exact size: only the cap rejects them.
  const padded = (size: number) => {
    const base = delivery(llmUsageMinimal, { padding: '' });
    return base.replace('"padding":""', `"padding":"${'x'.repeat(size - base.length)}"`);
  };
  const stream = (text: string) => {
    const bytes = new TextEncoder().encode(text);
    return new ReadableStream({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 1000) controller.enqueue(bytes.slice(i, i + 1000));
        controller.close();
      },
    });
  };

  it('accepts a body of exactly 64 KiB', async () => {
    expect((await push('llm-usage', padded(64 * 1024))).status).toBe(202);
  });

  it('rejects one byte more with 413, with or without Content-Length', async () => {
    const body = padded(64 * 1024 + 1);
    const withLength = await push('llm-usage', body);
    const chunked = await push('llm-usage', stream(body));

    expect(withLength.status).toBe(413);
    expect(chunked.status).toBe(413);
    expect(await chunked.json()).toEqual({ error: 'body_too_large' });
    expect(await deliveryRows()).toEqual([]);
  });

  it('takes a body nested 30,000 levels deep without crashing', async () => {
    const deep = `${'['.repeat(30_000)}${']'.repeat(30_000)}`;
    const body = delivery(llmUsageMinimal, { extra: 0 }).replace('"extra":0', `"extra":${deep}`);
    const nested = delivery(llmUsageMinimal).replace('"days":[]', `"days":${deep}`);

    expect((await push('llm-usage', body)).status).toBe(202);
    expect((await push('llm-usage', nested)).status).toBe(422);
  });

  it('rejects a body that is not declared as JSON with 415', async () => {
    const response = await push('llm-usage', delivery(llmUsageMinimal), {
      headers: { 'Content-Type': 'text/plain' },
    });
    expect(response.status).toBe(415);
  });

  it('rejects broken JSON with 400', async () => {
    const response = await push('llm-usage', '{"producer":');
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'malformed_json' });
  });

  it('reports schema failures by path and code, never echoing a value', async () => {
    const body = delivery(llmUsageMinimal, {
      producer: 'trellis',
      payload: {
        ...llmUsageMinimal.payload,
        last7Days: { costUsd: 'SECRET-VALUE-1', totalTokens: -5 },
        days: [{ date: 'SECRET-VALUE-2', costUsd: 1, totalTokens: 1 }],
      },
    });
    const response = await push('llm-usage', body);
    const text = await response.text();

    expect(response.status).toBe(422);
    expect(JSON.parse(text)).toEqual({
      error: 'invalid_payload',
      issueCount: 4,
      issues: expect.arrayContaining([
        { path: 'producer', code: 'invalid_value' },
        { path: 'payload.last7Days.costUsd', code: 'invalid_type' },
        { path: 'payload.last7Days.totalTokens', code: 'too_small' },
        { path: 'payload.days.0.date', code: 'invalid_format' },
      ]),
    });
    expect(text).not.toMatch(/SECRET-VALUE|trellis/);
    expect(await deliveryRows()).toEqual([]);
  });
});

describe('privacy', () => {
  const sensitive = [
    'repoName',
    'private-repo',
    '/home/x',
    'workstation',
    'sessionIds',
    'prompt',
    'secret plans',
    'notes',
    'weightKg',
    '81.4',
    'therapy',
    'spending',
    '1840',
    'A friend',
    'private journal',
    'antidepressants',
    'panic',
    'mood',
    'rating',
    'constructor',
    '__proto__',
    'hostname',
  ];

  it.each([
    ['llm-usage', 'llm-usage', llmUsageSensitive, llmUsageSnapshotSensitive],
    ['trellis', 'shelf', trellisSensitive, shelfSnapshotSensitive],
  ] as const)(
    'keeps unknown fields and unlisted ids from %s out of storage and responses',
    async (producer, source, fixture, expected) => {
      expect((await push(producer, delivery(fixture))).status).toBe(202);

      const stored = (await snapshotRow(source))?.json ?? '';
      const response = await fetchApi(`/v1/${source}`).then((r) => r.text());
      for (const text of sensitive) {
        expect(stored).not.toContain(text);
        expect(response).not.toContain(text);
      }
      expect(JSON.parse(stored)).toEqual(expected);
      expect(JSON.parse(response).data).toEqual(expected);
    }
  );
});

describe('replay and idempotency', () => {
  it('answers a retry of an accepted delivery with 200 and changes nothing', async () => {
    const body = delivery(llmUsageOk);
    expect((await push('llm-usage', body)).status).toBe(202);
    const before = await snapshotRow('llm-usage');

    // Immediately, inside the minimum interval, and again once the interval has passed.
    const retry = await push('llm-usage', body);
    await forgetLastPush('llm-usage');
    const later = await push('llm-usage', body);

    expect([retry.status, later.status]).toEqual([200, 200]);
    expect(await retry.json()).toEqual({ accepted: true });
    expect(await deliveryRows()).toHaveLength(1);
    expect((await snapshotRow('llm-usage'))?.json).toBe(before?.json);
  });

  it('rejects a reused delivery id with another body with 409 and keeps the first', async () => {
    const id = crypto.randomUUID();
    await push('llm-usage', delivery(llmUsageOk, { deliveryId: id }));
    await forgetLastPush('llm-usage');

    const response = await push('llm-usage', delivery(llmUsageMinimal, { deliveryId: id }));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'delivery_id_reused' });
    expect((await served('llm-usage')).data).toEqual(llmUsageSnapshotOk);
  });

  it('is not fooled by changed unsigned headers or a fresh signature', async () => {
    const body = delivery(llmUsageOk);
    await push('llm-usage', body);
    const replay = await push('llm-usage', body, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'User-Agent': 'replayer/1.0',
        'X-Forwarded-For': '203.0.113.9',
        'Idempotency-Key': crypto.randomUUID(),
      },
    });

    const trellis = delivery(trellisOk);
    await push('trellis', trellis);
    const resigned = await push('trellis', trellis, {
      timestamp: String(Number(nowSeconds()) + 1),
    });

    expect([replay.status, resigned.status]).toEqual([200, 200]);
    expect(await deliveryRows()).toHaveLength(2);
  });

  it('answers retries of a known delivery even while the rate limiter refuses', async () => {
    const body = delivery(llmUsageOk);
    await push('llm-usage', body);
    const limit = vi.spyOn(env.PUSH_RATE_LIMIT, 'limit').mockResolvedValue({ success: false });

    const retry = await push('llm-usage', body);
    const reused = await push(
      'llm-usage',
      delivery(llmUsageMinimal, { deliveryId: JSON.parse(body).deliveryId })
    );
    const fresh = await push('llm-usage', delivery(llmUsageMinimal));
    limit.mockRestore();

    expect([retry.status, reused.status, fresh.status]).toEqual([200, 409, 429]);
  });

  it('stores concurrent copies of one delivery once', async () => {
    const body = delivery(llmUsageOk);
    const statuses = (
      await Promise.all(Array.from({ length: 5 }, () => push('llm-usage', body)))
    ).map((r) => r.status);

    expect(statuses.sort()).toEqual([200, 200, 200, 200, 202]);
    expect(await deliveryRows()).toHaveLength(1);
  });
});

describe('admission', () => {
  it('admits one of two concurrent deliveries inside the interval and asks the other to retry', async () => {
    const first = delivery(llmUsageOk);
    const second = delivery(llmUsageMinimal);
    const [a, b] = await Promise.all([push('llm-usage', first), push('llm-usage', second)]);
    const statuses = [a.status, b.status].sort();
    const loser = a.status === 429 ? { response: a, body: first } : { response: b, body: second };

    expect(statuses).toEqual([202, 429]);
    expect(await loser.response.json()).toEqual({ error: 'too_soon' });
    expect(Number(loser.response.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(await deliveryRows()).toHaveLength(1);

    await forgetLastPush('llm-usage');
    expect((await push('llm-usage', loser.body)).status).toBe(202);
    expect(await deliveryRows()).toHaveLength(2);
  });

  it('never replaces a newer snapshot with an older one', async () => {
    const now = Date.now();
    await push('llm-usage', delivery(llmUsageOk, { sentAt: new Date(now - 60_000).toISOString() }));
    await forgetLastPush('llm-usage');

    const older = await push(
      'llm-usage',
      delivery(llmUsageMinimal, { sentAt: new Date(now - 120_000).toISOString() })
    );

    expect(older.status).toBe(409);
    expect(await older.json()).toEqual({ error: 'older_than_current' });
    expect(await deliveryRows()).toHaveLength(1);
    expect((await served('llm-usage')).data).toEqual(llmUsageSnapshotOk);
  });

  it.each([
    ['more than 24 h old', -24 * 3600_000 - 60_000],
    ['more than 5 min ahead', 5 * 60_000 + 30_000],
  ])('rejects a new delivery sent %s', async (_case, offset) => {
    const sentAt = new Date(Date.now() + offset).toISOString();
    const response = await push('llm-usage', delivery(llmUsageOk, { sentAt }));

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: 'sent_at_out_of_window' });
    expect(await snapshotRow('llm-usage')).toBeNull();
  });

  it('accepts a delivery up to 5 min ahead, for producer clock skew', async () => {
    const sentAt = new Date(Date.now() + 4 * 60_000).toISOString();
    expect((await push('llm-usage', delivery(llmUsageOk, { sentAt }))).status).toBe(202);
  });

  it('does not let an old delivery back in once its id has been forgotten', async () => {
    // As if accepted 8 days ago: its delivery row is past the 7-day retention.
    const eightDaysAgo = Date.now() - 8 * 24 * 3600_000;
    const old = delivery(llmUsageOk, { sentAt: new Date(eightDaysAgo).toISOString() });
    const { deliveryId } = JSON.parse(old);
    const hash = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(old))),
      (b) => b.toString(16).padStart(2, '0')
    ).join('');
    await env.DB.prepare(
      'INSERT INTO push_deliveries (producer, delivery_id, body_sha256, received_at) VALUES (?, ?, ?, ?)'
    )
      .bind('llm-usage', deliveryId, hash, eightDaysAgo)
      .run();

    expect((await push('llm-usage', old)).status).toBe(200);
    await runScheduled(env, [], Date.now());
    expect(await deliveryRows()).toEqual([]);

    const resent = await push('llm-usage', old);
    expect(resent.status).toBe(422);
    expect(await snapshotRow('llm-usage')).toBeNull();
  });

  it('keeps neither the delivery nor the snapshot when the batch fails, so a retry works', async () => {
    await env.DB.exec(
      "CREATE TRIGGER fail_delivery BEFORE INSERT ON push_deliveries BEGIN SELECT RAISE(ABORT, 'test'); END"
    );
    const body = delivery(llmUsageOk);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    const failed = await push('llm-usage', body);
    await env.DB.exec('DROP TRIGGER fail_delivery');

    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: 'internal_error' });
    expect(await deliveryRows()).toEqual([]);
    expect(await snapshotRow('llm-usage')).toBeNull();
    expect(JSON.stringify(logged.mock.calls)).not.toContain(env.PUSH_TOKEN_LLM_USAGE);
    logged.mockRestore();

    expect((await push('llm-usage', body)).status).toBe(202);
  });
});

describe('push routes', () => {
  it.each(['GET', 'PUT', 'DELETE'])('answer %s with 405', async (method) => {
    const response = await fetchApi('/v1/push/llm-usage', { method });
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
  });
});
