// Bounded upstream reads shared by the pull adapters, and the error they throw.

/** Why a pull failed. The cron runner records the code; nothing upstream is in it. */
export type PullErrorCode =
  | 'not_configured'
  | 'upstream_unreachable'
  | 'upstream_timeout'
  | 'upstream_too_large'
  | 'upstream_not_found'
  | 'upstream_rate_limited'
  | 'upstream_http_error'
  | 'upstream_error'
  | 'upstream_malformed'
  /** More past years than one history snapshot holds (ADR 0030). */
  | 'over_budget'
  /** The date in Rabat changed while the pull ran, so its answers would mix two dates. */
  | 'date_changed'
  /** A pull spread over several invocations read its part; it is not finished (ADR 0030). */
  | 'in_progress';

/**
 * A failed pull. The message is the code and nothing else, and no cause is attached: an
 * upstream error, URL or body can carry an API key or token.
 */
export class PullError extends Error {
  override readonly name = 'PullError';
  constructor(
    readonly code: PullErrorCode,
    /** Unix ms before which the upstream asked not to be called again (`Retry-After`). */
    readonly retryAt?: number
  ) {
    super(code);
  }
}

/** One upstream response: its status and its JSON body, or null when the body is not JSON. */
export interface UpstreamResponse {
  status: number;
  body: unknown;
  /** From a usable `Retry-After` header (`retryAfter`), whatever the status. */
  retryAt?: number;
}

/** The longest wait a `Retry-After` header is taken at. */
const maxRetryAfterMs = 24 * 60 * 60_000;

/**
 * Unix ms from a `Retry-After` header read at `now`: delay-seconds, or an HTTP date in the
 * IMF-fixdate form (RFC 9110, 10.2.3), at most a day ahead. Undefined for no header, any
 * other text, or a time not in the future, so the caller falls back to its own backoff.
 */
function retryAfter(value: string | null, now: number): number | undefined {
  const text = value?.trim() ?? '';
  const at = /^\d{1,10}$/.test(text)
    ? now + Number(text) * 1000
    : /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(text)
      ? Date.parse(text)
      : Number.NaN;
  return at > now ? Math.min(at, now + maxRetryAfterMs) : undefined;
}

/** What the adapters need of a contracts schema, so signals does not import zod itself. */
export interface Schema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

/** Each upstream request gives up after this long, whatever the caller's signal allows. */
const requestTimeoutMs = 5_000;

const userAgent = 'min7-signals (+https://ayagmar.dev)';

/**
 * GETs `url`, or POSTs `form` to it, and reads at most `maxBytes` of the response body as
 * JSON. Throws a `PullError` when the request fails, times out or the body is too large; any
 * HTTP status is returned as is. Workers traces record request URLs, so a secret goes in
 * `form` or a header, never in `url`.
 */
export async function getJson(
  url: string,
  options: {
    signal: AbortSignal;
    maxBytes: number;
    headers?: Record<string, string>;
    form?: URLSearchParams;
    /** This request's own deadline, whatever `signal` does. */
    timeoutMs?: number;
  }
): Promise<UpstreamResponse> {
  const timeout = AbortSignal.timeout(options.timeoutMs ?? requestTimeoutMs);
  const signal = AbortSignal.any([options.signal, timeout]);
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': userAgent, ...options.headers },
      signal,
      ...(options.form === undefined ? {} : { method: 'POST', body: options.form }),
    });
    const retryAt = retryAfter(response.headers.get('retry-after'), Date.now());
    const text = await readText(response, options.maxBytes);
    return {
      status: response.status,
      body: parseJson(text),
      ...(retryAt === undefined ? {} : { retryAt }),
    };
  } catch (error) {
    if (error instanceof PullError) throw error;
    throw new PullError(signal.aborted ? 'upstream_timeout' : 'upstream_unreachable');
  }
}

/** `getJson` for a part of a snapshot that may fail alone: a failed request becomes null. */
export async function getOptionalJson(
  ...args: Parameters<typeof getJson>
): Promise<UpstreamResponse | null> {
  try {
    return await getJson(...args);
  } catch (error) {
    if (error instanceof PullError) return null;
    throw error;
  }
}

async function readText(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (declared > maxBytes) {
    await response.body?.cancel();
    throw new PullError('upstream_too_large');
  }
  if (response.body === null) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new PullError('upstream_too_large');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function parseJson(text: string): unknown {
  if (text === '') return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** The error a non-2xx status stands for; a refusal keeps the upstream's `Retry-After`. */
function statusError({ status, retryAt }: UpstreamResponse): PullError {
  if (status === 404 || status === 410) return new PullError('upstream_not_found');
  if (status === 403 || status === 429) return new PullError('upstream_rate_limited', retryAt);
  return new PullError('upstream_http_error');
}

/** The body of a 200 response, checked against the wire schema. */
export function parseBody<T>(response: UpstreamResponse, schema: Schema<T>): T {
  if (response.status !== 200) throw statusError(response);
  const parsed = schema.safeParse(response.body);
  if (!parsed.success) throw new PullError('upstream_malformed');
  return parsed.data;
}

/** `read()`, or null when it throws a `PullError`: for a part of a snapshot that may fail alone. */
export function orNull<T>(read: () => T): T | null {
  try {
    return read();
  } catch (error) {
    if (error instanceof PullError) return null;
    throw error;
  }
}

/**
 * The normalized snapshot checked against its output schema, which also drops anything
 * not in it. A failure means the upstream sent values the contract does not allow.
 */
export function checkSnapshot<T>(schema: Schema<T>, snapshot: T): T {
  const parsed = schema.safeParse(snapshot);
  if (!parsed.success) throw new PullError('upstream_malformed');
  return parsed.data;
}

/**
 * Workers keeps at most six connections waiting for response headers and queues the rest,
 * with their timeouts already running. Adapters with more requests than that use `runLimited`.
 */
export const maxOpenRequests = 6;

/** Runs `tasks` with at most `limit` of them pending at once; results keep the tasks' order. */
export async function runLimited<T>(tasks: readonly (() => Promise<T>)[], limit: number) {
  const results: T[] = [];
  let next = 0;
  const worker = async () => {
    for (let index = next++; index < tasks.length; index = next++) {
      const task = tasks[index];
      if (task !== undefined) results[index] = await task();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}
