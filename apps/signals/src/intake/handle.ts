import { maxPushBodyBytes } from '@min7/contracts';
import type { Context } from 'hono';
import type { AppEnv } from '../env.ts';
import { logEvent } from '../security/log.ts';
import { matchesSecret, verifyHmacSha256 } from '../security/secrets.ts';
import { admitPush, findDelivery } from '../storage/admission.ts';
import { utc } from '../storage/d1.ts';
import { readBoundedBody } from './body.ts';
import type { Producer } from './producers.ts';

/** Seconds a signed timestamp may differ from the Worker's clock. */
const signatureWindowSeconds = 300;
/** A new delivery's `sentAt` may be at most this old or this far ahead (ADR 0011). */
const maxSentAtAgeMs = 24 * 60 * 60 * 1000;
const maxSentAtAheadMs = 5 * 60 * 1000;
/** Hard ceiling: at most one accepted push per producer per interval. */
const minPushIntervalSeconds = 60;
/** Most schema issues reported back; the rest are counted, not listed. */
const maxReportedIssues = 20;

const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
const encoder = new TextEncoder();

type Rejection = { status: 400 | 401 | 409 | 413 | 415 | 422 | 429; error: string };

const json = (status: number, body: object, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });

const isJson = (contentType: string | undefined) =>
  contentType !== undefined && /^application\/json\s*(;|$)/i.test(contentType);

const bearer = (authorization: string | undefined) =>
  /^Bearer ([\x21-\x7E]+)$/.exec(authorization ?? '')?.[1] ?? '';

const hex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');

/**
 * Token for every producer, then for signing producers an HMAC over `timestamp + "." + body`
 * inside the time window. Both checks always run, and failure has one answer, so a caller
 * never learns which part was wrong.
 */
async function authenticate<Push extends { deliveryId: string; sentAt: string }>(
  producer: Producer<Push>,
  c: Context<AppEnv>,
  body: Uint8Array<ArrayBuffer>,
  now: number
): Promise<boolean> {
  const tokenOk = await matchesSecret(
    bearer(c.req.header('authorization')),
    producer.tokens(c.env)
  );
  if (producer.signingKeys === null) return tokenOk;

  const timestamp = c.req.header('x-min7-timestamp') ?? '';
  const inWindow =
    /^\d{1,12}$/.test(timestamp) &&
    Math.abs(Math.floor(now / 1000) - Number(timestamp)) <= signatureWindowSeconds;
  const prefix = encoder.encode(`${timestamp}.`);
  const message = new Uint8Array(prefix.byteLength + body.byteLength);
  message.set(prefix);
  message.set(body, prefix.byteLength);
  const signatureOk = await verifyHmacSha256(
    producer.signingKeys(c.env),
    c.req.header('x-min7-signature') ?? '',
    message
  );
  return tokenOk && inWindow && signatureOk;
}

/**
 * `POST /v1/push/<producer>` (ADR 0011): content type, bounded body, authentication, rate
 * limit, schema, allowlist projection, then one atomic admission in D1.
 */
export async function handlePush<Push extends { deliveryId: string; sentAt: string }>(
  producer: Producer<Push>,
  c: Context<AppEnv>
): Promise<Response> {
  const reject = (
    { status, error }: Rejection,
    extra: object = {},
    headers: Record<string, string> = {}
  ) => {
    logEvent('warn', 'push rejected', { producer: producer.id, status, code: error });
    return json(status, { error, ...extra }, headers);
  };

  if (!isJson(c.req.header('content-type'))) {
    return reject({ status: 415, error: 'unsupported_media_type' });
  }
  if (Number(c.req.header('content-length') ?? 0) > maxPushBodyBytes) {
    return reject({ status: 413, error: 'body_too_large' });
  }
  const body = await readBoundedBody(c.req.raw.body, maxPushBodyBytes);
  if (body === null) return reject({ status: 413, error: 'body_too_large' });

  // Time is read after the body has arrived: an upload can take as long as the client likes,
  // and the signature window must not start counting before the request is complete.
  if (!(await authenticate(producer, c, body, Date.now()))) {
    return reject({ status: 401, error: 'unauthorized' });
  }
  let input: unknown;
  try {
    input = JSON.parse(decoder.decode(body));
  } catch {
    return reject({ status: 400, error: 'malformed_json' });
  }
  const parsed = producer.schema.safeParse(input);
  if (!parsed.success) {
    // Paths and codes come from the schema, never from the input's values.
    const issues = parsed.error.issues
      .slice(0, maxReportedIssues)
      .map(({ path, code }) => ({ path: path.join('.'), code }));
    return reject(
      { status: 422, error: 'invalid_payload' },
      { issues, issueCount: parsed.error.issues.length }
    );
  }
  const push = parsed.data;
  const inconsistent = producer.check?.(push) ?? null;
  if (inconsistent !== null) return reject({ status: 422, error: inconsistent });
  const bodySha256 = hex(await crypto.subtle.digest('SHA-256', body));

  // A retry of a delivery already accepted is answered before throttling, freshness or interval.
  const seen = await findDelivery(c.env.DB, producer.id, push.deliveryId, bodySha256);
  if (seen?.outcome === 'duplicate') return json(200, { accepted: true });
  if (seen?.outcome === 'conflict') return reject({ status: 409, error: 'delivery_id_reused' });

  // Only unseen deliveries count against the limiter, so a retry of an accepted delivery
  // always gets its 200. Best effort and per Cloudflare location; the D1 interval below is
  // the hard ceiling.
  const { success } = await c.env.PUSH_RATE_LIMIT.limit({ key: producer.id });
  if (!success) return reject({ status: 429, error: 'rate_limited' }, {}, { 'Retry-After': '60' });

  // Freshness and the minimum interval use the time of admission, read just before it.
  const receivedAt = Date.now();
  const sentAt = Date.parse(push.sentAt);
  if (sentAt < receivedAt - maxSentAtAgeMs || sentAt > receivedAt + maxSentAtAheadMs) {
    return reject({ status: 422, error: 'sent_at_out_of_window' });
  }

  const snapshot = producer.snapshotSchema.parse(producer.project(push));
  const result = await admitPush(c.env.DB, {
    producer: producer.id,
    source: producer.source,
    deliveryId: push.deliveryId,
    bodySha256,
    snapshotJson: JSON.stringify(snapshot),
    fetchedAt: utc(sentAt),
    receivedAt,
    minIntervalMs: minPushIntervalSeconds * 1000,
    ...(producer.historySince === undefined ? {} : { historySince: producer.historySince(push) }),
  });

  switch (result.outcome) {
    case 'accepted':
      logEvent('log', 'push accepted', { producer: producer.id, deliveryId: push.deliveryId });
      return json(202, { accepted: true });
    case 'duplicate':
      return json(200, { accepted: true });
    case 'conflict':
      return reject({ status: 409, error: 'delivery_id_reused' });
    case 'older_than_current':
      return reject({ status: 409, error: 'older_than_current' });
    case 'too_soon':
      return reject(
        { status: 429, error: 'too_soon' },
        {},
        {
          'Retry-After': String(result.retryAfterSeconds),
        }
      );
  }
}
