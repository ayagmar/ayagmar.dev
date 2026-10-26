// The checks that depend on time must use the time the body finished arriving, not the time
// the request started: a client controls how long its upload takes.
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { ProducerId } from '@min7/contracts';
import llmUsageMinimal from '@min7/contracts/fixtures/llm-usage/push/accept/minimal.json' with {
  type: 'json',
};
import trellisMinimal from '@min7/contracts/fixtures/trellis/push/accept/minimal.json' with {
  type: 'json',
};
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { app } from '../src/app.ts';
import { clearState, delivery, deliveryRows, sign } from './helpers.ts';

let clock = 0;
beforeEach(async () => {
  await clearState();
  clock = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
});
afterEach(() => vi.restoreAllMocks());

/** Starts a push whose body arrives only when `finish` is called. */
function slowPush(producer: ProducerId, body: string, headers: Record<string, string> = {}) {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  const token = producer === 'trellis' ? env.PUSH_TOKEN_TRELLIS : env.PUSH_TOKEN_LLM_USAGE;
  const ctx = createExecutionContext();
  const pending = app.fetch(
    new Request(`https://api.ayagmar.dev/v1/push/${producer}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...headers },
      body: stream,
    }),
    env,
    ctx
  );
  return {
    async finish() {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
      const response = await pending;
      await waitOnExecutionContext(ctx);
      return response;
    },
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 1));

it('checks the signature window when the body has arrived', async () => {
  const body = delivery(trellisMinimal, { sentAt: new Date(clock).toISOString() });
  const timestamp = String(Math.floor(clock / 1000));
  const upload = slowPush('trellis', body, {
    'X-Min7-Timestamp': timestamp,
    'X-Min7-Signature': await sign(body, timestamp),
  });
  await tick();
  clock += 301_000;

  expect((await upload.finish()).status).toBe(401);
});

it('checks sentAt freshness when the body has arrived', async () => {
  const sentAt = new Date(clock - 24 * 3600_000 + 1000).toISOString();
  const upload = slowPush('llm-usage', delivery(llmUsageMinimal, { sentAt }));
  await tick();
  clock += 2000;

  expect((await upload.finish()).status).toBe(422);
});

it('measures the minimum interval between admissions, not between upload starts', async () => {
  const sentAt = new Date(clock).toISOString();
  const first = slowPush('llm-usage', delivery(llmUsageMinimal, { sentAt }));
  await tick();
  clock += 61_000;
  const second = slowPush('llm-usage', delivery(llmUsageMinimal, { sentAt }));
  await tick();

  const statuses = [(await first.finish()).status, (await second.finish()).status];

  expect(statuses).toEqual([202, 429]);
  expect(await deliveryRows()).toHaveLength(1);
});
