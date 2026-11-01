import { env, exports } from 'cloudflare:workers';
import { dailySources, type ProducerId, sourceIds } from '@min7/contracts';

const origin = 'https://api.ayagmar.dev';

export const fetchApi = (path: string, init?: RequestInit) =>
  exports.default.fetch(new Request(`${origin}${path}`, init));

const encoder = new TextEncoder();
const hex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');

export async function sign(body: string, timestamp: string, key = env.PUSH_HMAC_TRELLIS) {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return hex(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(`${timestamp}.${body}`)));
}

export const nowSeconds = () => String(Math.floor(Date.now() / 1000));

/** A fixture as a new delivery: fresh id, sent now unless overridden. */
export const delivery = <T extends object>(fixture: T, overrides: object = {}) =>
  JSON.stringify({
    ...fixture,
    deliveryId: crypto.randomUUID(),
    sentAt: new Date().toISOString(),
    ...overrides,
  });

type PushOptions = {
  token?: string | null;
  headers?: Record<string, string>;
  timestamp?: string;
  signature?: string;
  hmacKey?: string;
};

/** A correctly authenticated push unless options say otherwise. */
export async function push(producer: ProducerId, body: BodyInit, options: PushOptions = {}) {
  const tokens = {
    'llm-usage': env.PUSH_TOKEN_LLM_USAGE,
    trellis: env.PUSH_TOKEN_TRELLIS,
    desktop: env.PUSH_TOKEN_DESKTOP,
  };
  const token = options.token === undefined ? tokens[producer] : options.token;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  if (producer === 'trellis' && typeof body === 'string') {
    const timestamp = options.timestamp ?? nowSeconds();
    headers['X-Min7-Timestamp'] = timestamp;
    headers['X-Min7-Signature'] =
      options.signature ?? (await sign(body, timestamp, options.hmacKey));
  }
  return fetchApi(`/v1/push/${producer}`, {
    method: 'POST',
    body,
    headers: { ...headers, ...options.headers },
  });
}

export const deliveryRows = async () =>
  (await env.DB.prepare('SELECT * FROM push_deliveries ORDER BY received_at').all()).results;

export const snapshotRow = (source: string) =>
  env.DB.prepare('SELECT * FROM snapshots WHERE source = ?')
    .bind(source)
    .first<{ json: string | null; fetched_at: string | null; last_push_at: number | null }>();

/** Lets the next push in without waiting out the minimum interval. */
export const forgetLastPush = (source: string) =>
  env.DB.prepare('UPDATE snapshots SET last_push_at = last_push_at - 3600000 WHERE source = ?')
    .bind(source)
    .run();

/** Every test starts with empty tables and an empty edge cache. */
export async function clearState() {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM snapshots'),
    env.DB.prepare('DELETE FROM push_deliveries'),
    env.DB.prepare('DELETE FROM pull_progress'),
    env.DB.prepare('DELETE FROM daily'),
  ]);
  await Promise.all(sourceIds.map((source) => caches.default.delete(`${origin}/v1/${source}`)));
  // Daily history is cached per series and block (ADR 0038): the last 28 days and each month.
  const months = Array.from({ length: 36 }, (_, i) =>
    new Date(Date.UTC(2025, i, 1)).toISOString().slice(0, 7)
  );
  await Promise.all(
    dailySources.flatMap((series) =>
      ['last=28', ...months.map((month) => `month=${month}`)].map((block) =>
        caches.default.delete(`${origin}/v1/days/${series}?${block}`)
      )
    )
  );
}
