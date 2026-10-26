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
  | 'upstream_malformed';

/**
 * A failed pull. The message is the code and nothing else, and no cause is attached: an
 * upstream error, URL or body can carry an API key or token.
 */
export class PullError extends Error {
  override readonly name = 'PullError';
  constructor(readonly code: PullErrorCode) {
    super(code);
  }
}

/** One upstream response: its status and its JSON body, or null when the body is not JSON. */
export interface UpstreamResponse {
  status: number;
  body: unknown;
}

/** What the adapters need of a contracts schema, so signals does not import zod itself. */
export interface Schema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

/** Each upstream request gives up after this long, whatever the caller's signal allows. */
const requestTimeoutMs = 5_000;

const userAgent = 'min7-signals (+https://ayagmar.dev)';

/**
 * GETs `url` and reads at most `maxBytes` of its body as JSON. Throws a `PullError` when the
 * request fails, times out or the body is too large; any HTTP status is returned as is.
 */
export async function getJson(
  url: string,
  options: { signal: AbortSignal; maxBytes: number; headers?: Record<string, string> }
): Promise<UpstreamResponse> {
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(requestTimeoutMs)]);
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': userAgent, ...options.headers },
      signal,
    });
    const text = await readText(response, options.maxBytes);
    return { status: response.status, body: parseJson(text) };
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

/** The error a non-2xx status stands for. */
function statusError(status: number): PullError {
  if (status === 404 || status === 410) return new PullError('upstream_not_found');
  if (status === 403 || status === 429) return new PullError('upstream_rate_limited');
  return new PullError('upstream_http_error');
}

/** The body of a 200 response, checked against the wire schema. */
export function parseBody<T>(response: UpstreamResponse, schema: Schema<T>): T {
  if (response.status !== 200) throw statusError(response.status);
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
