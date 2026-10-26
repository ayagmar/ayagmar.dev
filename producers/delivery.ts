// What both producers on the owner's machine share (ADR 0014, ADR 0032): where the token and
// the state live, one run at a time, the pending delivery on disk, and the retry loop. Node
// built-ins only, so the directory runs as installed, without the repo or its dependencies.
//
// A run: take the lock; resend the pending delivery if there is one and it still holds, else
// collect a new one and persist it before the first attempt; wait for any Retry-After deadline
// an earlier run was given; send it until signals acknowledges it, refuses it for good, or the
// attempts run out.
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Exit statuses, the sysexits names systemd's unit files refer to. */
export const exitCodes = {
  ok: 0,
  /** Signals refused this body for good (409, 422), or the collected data was unusable. */
  dataError: 65,
  usage: 64,
  /** Worth trying again later: network, 5xx, 429, a collector that failed. */
  retryLater: 75,
  /** Needs the operator: credentials, configuration, unreadable state, an unexpected answer. */
  operator: 78,
} as const;

export type ExitCode = (typeof exitCodes)[keyof typeof exitCodes];

export type ProducerId = 'llm-usage' | 'desktop';

/** A push body as the producer builds it; `payload` is the producer's own. */
export interface Delivery {
  producer: ProducerId;
  deliveryId: string;
  sentAt: string;
  payload: object;
}

/** A failure with a fixed code and exit status: never a message from a command or a body. */
export class ProducerError extends Error {
  readonly code: string;
  readonly exitCode: ExitCode;
  constructor(code: string, exitCode: ExitCode) {
    super(code);
    this.code = code;
    this.exitCode = exitCode;
  }
}

export interface Producer {
  id: ProducerId;
  /** Collects a new delivery, or throws a ProducerError. */
  build(): Promise<Delivery>;
  /** Whether a pending delivery no longer describes the machine and must not be sent. */
  supersedes?(pending: Delivery): boolean;
}

type LogField = string | number | boolean;

export interface Runtime {
  /** Full push URL. */
  endpoint: string;
  token: string;
  stateDir: string;
  fetch: typeof fetch;
  now(): number;
  sleep(ms: number): Promise<void>;
  random(): number;
  /** One JSON line: fixed event names, statuses, codes and ids only. */
  log(fields: Record<string, LogField>): void;
}

export const productionOrigin = 'https://api.ayagmar.dev';

/** A pending delivery older than this is rebuilt: signals refuses a sentAt over 24 h old. */
export const maxPendingAgeMs = 23 * 60 * 60 * 1000;
const attempts = 5;
const firstBackoffMs = 5_000;
const maxBackoffMs = 120_000;
/** A longer wait ends the run; systemd starts it again (RestartForceExitStatus=75). */
const maxWaitMs = 5 * 60_000;
/** A longer Retry-After is taken as this long, so a bad header cannot stop the producer. */
const maxRetryAfterMs = 24 * 60 * 60 * 1000;
const requestTimeoutMs = 30_000;
/** More of an answer than this is never read. */
const maxAnswerBytes = 4096;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const errorCode = /^[a-z][a-z0-9_]{0,63}$/;

// State: one private directory per producer.

const pendingFile = (dir: string) => join(dir, 'pending.json');
/** When signals' last Retry-After ends, as an ISO instant; absent when there is none. */
const deadlineFile = (dir: string) => join(dir, 'retry-after');
const tempMarker = '.tmp-';
const isoInstant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** Creates the directory if needed and makes it private, even if it already existed. */
export function privateDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
}

/**
 * The pending delivery's exact bytes, or undefined when there is none. A file that is not a
 * delivery of this producer fails closed: it is left as it is for the operator to look at.
 */
export function readPending(dir: string, producer: ProducerId): string | undefined {
  let body: string;
  try {
    body = readFileSync(pendingFile(dir), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new ProducerError('pending_unreadable', exitCodes.operator);
  }
  chmodSync(pendingFile(dir), 0o600);
  let parsed: Partial<Delivery>;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new ProducerError('pending_unreadable', exitCodes.operator);
  }
  if (
    parsed?.producer !== producer ||
    typeof parsed.deliveryId !== 'string' ||
    !uuid.test(parsed.deliveryId) ||
    typeof parsed.sentAt !== 'string' ||
    Number.isNaN(Date.parse(parsed.sentAt)) ||
    typeof parsed.payload !== 'object' ||
    parsed.payload === null
  ) {
    throw new ProducerError('pending_unreadable', exitCodes.operator);
  }
  return body;
}

/**
 * Writes `text` to a private temporary file, syncs it, renames it over `file` and syncs the
 * directory, so a crash leaves the old complete file or the new one, never part.
 */
function writeAtomically(dir: string, file: string, text: string): void {
  const temp = `${file}${tempMarker}${process.pid}`;
  const fd = openSync(temp, 'wx', 0o600);
  try {
    writeSync(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temp, file);
  const dirFd = openSync(dir, 'r');
  try {
    fsyncSync(dirFd);
  } finally {
    closeSync(dirFd);
  }
}

export function persistPending(dir: string, body: string): void {
  writeAtomically(dir, pendingFile(dir), body);
}

/**
 * When signals said to try again, in ms since the epoch, or undefined. A file that is not an
 * instant fails closed, like an unreadable pending delivery.
 */
function readDeadline(dir: string): number | undefined {
  let text: string;
  try {
    text = readFileSync(deadlineFile(dir), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new ProducerError('retry_after_unreadable', exitCodes.operator);
  }
  const at = Date.parse(text);
  if (!isoInstant.test(text) || Number.isNaN(at)) {
    throw new ProducerError('retry_after_unreadable', exitCodes.operator);
  }
  return at;
}

/** Keeps signals' Retry-After for later runs, or clears it once signals has answered otherwise. */
function saveDeadline(dir: string, at: number | undefined): void {
  if (at === undefined) rmSync(deadlineFile(dir), { force: true });
  else writeAtomically(dir, deadlineFile(dir), new Date(at).toISOString());
}

/** Removes the pending file only if it still holds `body`. */
function removePending(dir: string, body: string): void {
  try {
    if (readFileSync(pendingFile(dir), 'utf8') === body) rmSync(pendingFile(dir));
  } catch {}
}

/** Temporary files a crashed run left; under the lock no other run can be writing one. */
function removeTemporaryFiles(dir: string): void {
  for (const file of readdirSync(dir)) {
    if (file.includes(tempMarker)) rmSync(join(dir, file), { force: true });
  }
}

// Sending.

type Answer =
  | { kind: 'accepted'; status: number }
  | { kind: 'refused'; status: number; code: string }
  | { kind: 'retry'; status: number; retryAfterMs: number }
  | { kind: 'operator'; status: number; code: string };

async function readBounded(response: Response): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    length += value.byteLength;
    if (length > maxAnswerBytes) {
      await reader.cancel();
      return '';
    }
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** `Retry-After` in seconds or as an HTTP date, in ms from `now`; 0 when absent or unreadable. */
export function retryAfterMs(header: string | null, now: number): number {
  if (header === null) return 0;
  if (/^\d{1,6}$/.test(header.trim())) {
    return Math.min(maxRetryAfterMs, Number(header.trim()) * 1000);
  }
  const at = Date.parse(header);
  return Number.isNaN(at) ? 0 : Math.min(maxRetryAfterMs, Math.max(0, at - now));
}

async function post(rt: Runtime, body: string): Promise<Answer> {
  let response: Response;
  try {
    response = await rt.fetch(rt.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${rt.token}` },
      body,
      // A redirect is not the push endpoint: it is a configuration problem, never followed.
      redirect: 'manual',
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
  } catch {
    return { kind: 'retry', status: 0, retryAfterMs: 0 };
  }
  const { status } = response;
  let text: string;
  try {
    text = await readBounded(response);
  } catch {
    // The connection broke or timed out while the answer was read. After 200 or 202 signals may
    // have stored the push; the same bytes resent are acknowledged as a duplicate. Any other
    // status says enough on its own.
    text = '';
    if (status === 200 || status === 202) return { kind: 'retry', status, retryAfterMs: 0 };
  }
  let answer: { accepted?: unknown; error?: unknown } = {};
  try {
    answer = JSON.parse(text);
  } catch {}
  const code =
    typeof answer?.error === 'string' && errorCode.test(answer.error) ? answer.error : 'none';
  if ((status === 200 || status === 202) && answer?.accepted === true) {
    return { kind: 'accepted', status };
  }
  if (status === 409 || status === 422) return { kind: 'refused', status, code };
  if (status === 429 || status >= 500) {
    return {
      kind: 'retry',
      status,
      retryAfterMs: retryAfterMs(response.headers.get('retry-after'), rt.now()),
    };
  }
  return { kind: 'operator', status, code };
}

/**
 * Sends `body` until it is acknowledged, refused for good, or the attempts run out, never
 * before a Retry-After deadline an earlier attempt or run was given.
 */
async function send(rt: Runtime, producer: ProducerId, body: string): Promise<ExitCode> {
  const { deliveryId } = JSON.parse(body) as Delivery;
  const deadline = readDeadline(rt.stateDir);
  if (deadline !== undefined) {
    // Capped, so a clock set back cannot hold the delivery for longer than signals could ask.
    const wait = Math.min(maxRetryAfterMs, deadline - rt.now());
    if (wait > maxWaitMs) {
      rt.log({ producer, deliveryId, attempt: 0, event: 'retry_later', waitMs: wait });
      return exitCodes.retryLater;
    }
    if (wait > 0) await rt.sleep(wait);
  }
  for (let attempt = 1; ; attempt++) {
    const answer = await post(rt, body);
    const fields = { producer, deliveryId, attempt, status: answer.status };
    saveDeadline(
      rt.stateDir,
      answer.kind === 'retry' && answer.retryAfterMs > 0
        ? rt.now() + answer.retryAfterMs
        : undefined
    );
    switch (answer.kind) {
      case 'accepted':
        removePending(rt.stateDir, body);
        rt.log({ ...fields, event: 'delivered' });
        return exitCodes.ok;
      case 'refused':
        // This body can never be accepted; the next run collects a new one.
        removePending(rt.stateDir, body);
        rt.log({ ...fields, event: 'refused', code: answer.code });
        return exitCodes.dataError;
      case 'operator':
        rt.log({ ...fields, event: 'needs_operator', code: answer.code });
        return exitCodes.operator;
      case 'retry': {
        const backoff = Math.min(maxBackoffMs, firstBackoffMs * 2 ** (attempt - 1));
        const wait = Math.max(answer.retryAfterMs, Math.round(backoff * (0.5 + rt.random() / 2)));
        if (attempt >= attempts || wait > maxWaitMs) {
          rt.log({ ...fields, event: 'retry_later' });
          return exitCodes.retryLater;
        }
        rt.log({ ...fields, event: 'retrying', waitMs: wait });
        await rt.sleep(wait);
      }
    }
  }
}

/** One run, holding the lock: resend or collect, persist, send. */
export async function deliver(rt: Runtime, producer: Producer): Promise<ExitCode> {
  try {
    privateDir(rt.stateDir);
    removeTemporaryFiles(rt.stateDir);
    let body = readPending(rt.stateDir, producer.id);
    if (body !== undefined) {
      const pending = JSON.parse(body) as Delivery;
      const fields = { producer: producer.id, deliveryId: pending.deliveryId };
      if (rt.now() - Date.parse(pending.sentAt) > maxPendingAgeMs) {
        rt.log({ ...fields, event: 'retired', code: 'expired' });
        rmSync(pendingFile(rt.stateDir));
        body = undefined;
      } else if (producer.supersedes?.(pending)) {
        rt.log({ ...fields, event: 'retired', code: 'superseded' });
        rmSync(pendingFile(rt.stateDir));
        body = undefined;
      } else {
        rt.log({ ...fields, event: 'resending' });
      }
    }
    if (body === undefined) {
      body = JSON.stringify(await producer.build());
      persistPending(rt.stateDir, body);
    }
    return await send(rt, producer.id, body);
  } catch (error) {
    if (error instanceof ProducerError) {
      rt.log({ producer: producer.id, event: 'failed', code: error.code });
      return error.exitCode;
    }
    rt.log({ producer: producer.id, event: 'failed', code: 'unexpected' });
    return exitCodes.operator;
  }
}

// Configuration: production, a dry run, or a local test endpoint.

const tokenPattern = /^[\x21-\x7E]{32,512}$/;

/**
 * The producer's own token from the owner's private signals env file (`NAME=value` lines):
 * only the line named `name` is read, and its value is never printed. The file must not be
 * readable by anyone but its owner.
 */
export function tokenFromEnvFile(path: string, name: string): string {
  let text: string;
  try {
    if ((statSync(path).mode & 0o077) !== 0) {
      throw new ProducerError('credentials_not_private', exitCodes.operator);
    }
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if (error instanceof ProducerError) throw error;
    throw new ProducerError('credentials_unreadable', exitCodes.operator);
  }
  for (const line of text.split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=(.*)$/.exec(line);
    if (match?.[1] !== name) continue;
    const value = (match[2] ?? '').trim();
    if (!tokenPattern.test(value)) break;
    return value;
  }
  throw new ProducerError('token_missing', exitCodes.operator);
}

const loopback = /^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d{1,5}$/;

export type Mode =
  | { kind: 'dry-run'; fixtures: string }
  | { kind: 'production' }
  | { kind: 'local'; fixtures: string; origin: string; token: string; stateDir: string };

/**
 * The run's mode from its arguments and environment. Production takes no option: its
 * collectors, credentials, state and endpoint are fixed. `--dry-run --fixtures <dir>` prints
 * the body built from fixture files and reads nothing else. A local run, for tests and
 * `wrangler dev`, needs a loopback `MIN7_TEST_ENDPOINT`, `MIN7_TEST_TOKEN`, `MIN7_STATE_DIR`
 * and fixtures, so it can never send real data or use the real token or state.
 */
export function parseMode(argv: readonly string[], env: NodeJS.ProcessEnv): Mode {
  const usage = () => new ProducerError('usage', exitCodes.usage);
  let dryRun = false;
  let fixtures: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dry-run') dryRun = true;
    else if (argv[i] === '--fixtures' && argv[i + 1] !== undefined) fixtures = argv[++i];
    else throw usage();
  }
  const testEndpoint = env.MIN7_TEST_ENDPOINT;
  if (dryRun) {
    if (fixtures === undefined || testEndpoint !== undefined) throw usage();
    return { kind: 'dry-run', fixtures };
  }
  if (testEndpoint === undefined) {
    if (fixtures !== undefined) throw usage();
    return { kind: 'production' };
  }
  const { MIN7_TEST_TOKEN: token, MIN7_STATE_DIR: stateDir } = env;
  if (!loopback.test(testEndpoint) || !token || !stateDir || fixtures === undefined) {
    throw usage();
  }
  return { kind: 'local', fixtures, origin: testEndpoint, token, stateDir };
}

/** `$XDG_STATE_HOME/min7/<producer>`, by default `~/.local/state/min7/<producer>`. */
export const productionStateDir = (producer: ProducerId, env: NodeJS.ProcessEnv) =>
  join(env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'min7', producer);

/** `$XDG_CONFIG_HOME/ayagmar.dev/signals.env`, by default `~/.config/ayagmar.dev/signals.env`. */
export const productionEnvFile = (env: NodeJS.ProcessEnv) =>
  join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'ayagmar.dev', 'signals.env');

const log = (fields: Record<string, LogField>) => console.log(JSON.stringify(fields));

/** Exit status of `flock` when another run holds the lock. */
const busy = 111;

/**
 * Runs `main` once per state directory: the script runs itself again under `flock`, which the
 * kernel releases when the process ends, crash included. A run that finds the lock taken
 * leaves the delivery to the run holding it.
 */
function underLock(stateDir: string, producer: ProducerId, main: () => Promise<ExitCode>) {
  const lock = join(stateDir, 'lock');
  if (process.env.MIN7_PRODUCER_LOCK === lock) return main();
  privateDir(stateDir);
  const child = spawnSync(
    'flock',
    [
      '--nonblock',
      '--conflict-exit-code',
      String(busy),
      lock,
      process.execPath,
      ...process.execArgv,
      ...process.argv.slice(1),
    ],
    { stdio: 'inherit', env: { ...process.env, MIN7_PRODUCER_LOCK: lock } }
  );
  if (child.status === busy) {
    log({ producer, event: 'busy' });
    return Promise.resolve(exitCodes.ok);
  }
  return Promise.resolve((child.status ?? exitCodes.operator) as ExitCode);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The command line of a producer script. `make` turns a fixtures directory, or null for this
 * machine, into the producer.
 */
export async function cli(
  id: ProducerId,
  tokenName: string,
  make: (fixtures: string | null) => Producer
): Promise<ExitCode> {
  let mode: Mode;
  try {
    mode = parseMode(process.argv.slice(2), process.env);
  } catch {
    console.error(
      `usage: ${id}.ts | ${id}.ts --dry-run --fixtures <dir>\n` +
        '  a local run also needs MIN7_TEST_ENDPOINT (loopback), MIN7_TEST_TOKEN and MIN7_STATE_DIR'
    );
    return exitCodes.usage;
  }
  if (mode.kind === 'dry-run') {
    try {
      console.log(JSON.stringify(await make(mode.fixtures).build(), null, 2));
      return exitCodes.ok;
    } catch (error) {
      const code = error instanceof ProducerError ? error.code : 'unexpected';
      log({ producer: id, event: 'failed', code });
      return error instanceof ProducerError ? error.exitCode : exitCodes.operator;
    }
  }
  const local = mode.kind === 'local' ? mode : undefined;
  const stateDir = local?.stateDir ?? productionStateDir(id, process.env);
  return underLock(stateDir, id, async () => {
    let token: string;
    try {
      token = local?.token ?? tokenFromEnvFile(productionEnvFile(process.env), tokenName);
    } catch (error) {
      log({ producer: id, event: 'failed', code: (error as ProducerError).code ?? 'unexpected' });
      return exitCodes.operator;
    }
    return deliver(
      {
        endpoint: `${local?.origin ?? productionOrigin}/v1/push/${id}`,
        token,
        stateDir,
        fetch,
        now: Date.now,
        sleep,
        random: Math.random,
        log,
      },
      make(local?.fixtures ?? null)
    );
  });
}
