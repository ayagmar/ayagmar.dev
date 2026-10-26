// The producers' shared delivery (ADR 0014, ADR 0032): what is on disk and what is sent across
// crashes, restarts, every class of answer and two runs at once. Everything runs against a
// temporary state directory, a stand-in producer and a fake or loopback signals.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  type Delivery,
  deliver,
  exitCodes,
  maxPendingAgeMs,
  type Producer,
  parseMode,
  type Runtime,
  tokenFromEnvFile,
} from './delivery.ts';
import { writeSamples } from './samples.ts';

const token = 'test-producer-token-0000000000000000000';
const now = Date.parse('2026-10-26T12:00:00Z');

let dir: string;
let stateDir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'min7-producer-'));
  stateDir = join(dir, 'state');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const pendingPath = () => join(stateDir, 'pending.json');
const pending = () => (existsSync(pendingPath()) ? readFileSync(pendingPath(), 'utf8') : undefined);

/** A producer whose every build is a new delivery; `built` counts them. */
function standIn(overrides: Partial<Producer> = {}) {
  const state = { built: 0 };
  const producer: Producer = {
    id: 'desktop',
    async build(): Promise<Delivery> {
      state.built++;
      return {
        producer: 'desktop',
        deliveryId: crypto.randomUUID(),
        sentAt: new Date(now).toISOString(),
        payload: { n: state.built },
      };
    },
    ...overrides,
  };
  return { producer, state };
}

type Reply =
  | { status: number; body?: string; headers?: Record<string, string> }
  | 'network'
  | 'hang';

/** signals as a list of replies, one per request; records each request's body and headers. */
function signals(...replies: Reply[]) {
  const requests: { body: string; authorization: string | null; redirect: string | undefined }[] =
    [];
  const fetch = (async (_url: string, init: RequestInit) => {
    requests.push({
      body: String(init.body),
      authorization: new Headers(init.headers).get('authorization'),
      redirect: init.redirect,
    });
    const reply = replies.shift() ?? { status: 500 };
    if (reply === 'network') throw new TypeError('fetch failed');
    if (reply === 'hang') return new Promise<never>(() => {});
    return new Response(reply.body ?? null, { status: reply.status, headers: reply.headers ?? {} });
  }) as typeof globalThis.fetch;
  return { fetch, requests };
}

const accepted = (status = 202) => ({ status, body: '{"accepted":true}' });

function runtime(fetch: typeof globalThis.fetch, extra: Partial<Runtime> = {}) {
  const logs: string[] = [];
  const waits: number[] = [];
  const rt: Runtime = {
    endpoint: 'http://127.0.0.1:1/v1/push/desktop',
    token,
    stateDir,
    fetch,
    now: () => now,
    sleep: async (ms) => {
      waits.push(ms);
    },
    random: () => 0.5,
    log: (fields) => logs.push(JSON.stringify(fields)),
    ...extra,
  };
  return { rt, logs, waits };
}

describe('a new delivery', () => {
  // Catches a body sent before it is on disk: a crash mid-request would lose its id.
  it('is on disk, private, before the first attempt, and gone once acknowledged', async () => {
    const { producer } = standIn();
    let onDisk: string | undefined;
    const fetch = (async (_url: string, init: RequestInit) => {
      onDisk = pending();
      assert.equal(statSync(pendingPath()).mode & 0o777, 0o600);
      assert.equal(statSync(stateDir).mode & 0o777, 0o700);
      assert.equal(onDisk, init.body);
      return new Response('{"accepted":true}', { status: 202 });
    }) as typeof globalThis.fetch;

    assert.equal(await deliver(runtime(fetch).rt, producer), exitCodes.ok);
    assert.ok(onDisk);
    assert.equal(pending(), undefined);
  });

  // Catches a token or a body ending up in the journal.
  it('logs neither the token nor the body', async () => {
    const { producer } = standIn();
    const { fetch, requests } = signals({ status: 500 }, accepted());
    const { rt, logs } = runtime(fetch);
    await deliver(rt, producer);

    assert.equal(requests[0]?.authorization, `Bearer ${token}`);
    assert.equal(requests[0]?.redirect, 'manual');
    for (const line of logs) {
      assert.ok(!line.includes(token));
      assert.ok(!line.includes('"payload"'));
    }
  });
});

describe('answers', () => {
  // Catches a delivery dropped on something other than signals' acknowledgement.
  for (const [name, reply] of [
    ['200 without the acknowledgement', { status: 200, body: '<html>ok</html>' }],
    ['401', { status: 401, body: '{"error":"unauthorized"}' }],
    ['413', { status: 413, body: '{"error":"body_too_large"}' }],
    ['415', { status: 415 }],
    ['a redirect', { status: 302, headers: { location: 'https://elsewhere.invalid/' } }],
  ] as const) {
    it(`keeps the body and stops for the operator on ${name}`, async () => {
      const { producer } = standIn();
      const { fetch, requests } = signals(reply);
      assert.equal(await deliver(runtime(fetch).rt, producer), exitCodes.operator);
      assert.equal(requests.length, 1);
      assert.equal(pending(), requests[0]?.body);
    });
  }

  // Catches a body signals will never take being resent forever.
  for (const status of [409, 422]) {
    it(`drops the body on ${status} and logs only an allowlisted code`, async () => {
      const { producer } = standIn();
      const { fetch } = signals(
        { status, body: '{"error":"booted_at_out_of_range"}' },
        { status, body: '{"error":"Bearer leaked-value /home/x"}' }
      );
      const { rt, logs } = runtime(fetch);

      assert.equal(await deliver(rt, producer), exitCodes.dataError);
      assert.equal(pending(), undefined);
      assert.match(logs.at(-1) ?? '', /"code":"booted_at_out_of_range"/);

      assert.equal(await deliver(rt, producer), exitCodes.dataError);
      assert.match(logs.at(-1) ?? '', /"code":"none"/);
      assert.ok(!logs.join('\n').includes('leaked-value'));
    });
  }

  // Catches a retry that changes the body or id, or comes back before Retry-After.
  it('retries network errors, 5xx and 429 with the same bytes, no sooner than Retry-After', async () => {
    const { producer, state } = standIn();
    const { fetch, requests } = signals(
      'network',
      { status: 503 },
      { status: 429, body: '{"error":"rate_limited"}', headers: { 'retry-after': '60' } },
      accepted(200)
    );
    const { rt, waits } = runtime(fetch);

    assert.equal(await deliver(rt, producer), exitCodes.ok);
    assert.equal(state.built, 1);
    assert.equal(new Set(requests.map((r) => r.body)).size, 1);
    assert.equal(waits.length, 3);
    assert.ok((waits[2] ?? 0) >= 60_000);
    assert.ok((waits[1] ?? 0) > (waits[0] ?? 0));
  });

  // Catches a connection lost while the acknowledgement is read stopping for the operator: the
  // push may well be stored, and the same bytes resent get 200 as a duplicate.
  it('resends the same bytes when a 2xx answer breaks off', async () => {
    const bodies: string[] = [];
    const srv = createServer((request, response) => {
      let body = '';
      request.on('data', (chunk) => {
        body += chunk;
      });
      request.on('end', () => {
        bodies.push(body);
        response.writeHead(bodies.length === 1 ? 202 : 200, {
          'content-type': 'application/json',
          'content-length': '17',
        });
        if (bodies.length === 1) {
          response.write('{"accepted"');
          setImmediate(() => response.destroy());
        } else {
          response.end('{"accepted":true}');
        }
      });
    });
    await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = srv.address() as { port: number };
      const { producer, state } = standIn();
      const { rt, logs } = runtime(fetch, { endpoint: `http://127.0.0.1:${port}/v1/push/desktop` });
      assert.equal(await deliver(rt, producer), exitCodes.ok);
      assert.equal(bodies.length, 2);
      assert.equal(bodies[0], bodies[1]);
      assert.equal(state.built, 1);
      assert.match(logs.join('\n'), /"status":202,"event":"retrying"/);
      assert.equal(pending(), undefined);
    } finally {
      srv.close();
    }
  });

  // Catches a hot loop, or a body dropped when signals is down for a while.
  it('gives up after its attempts and keeps the body for the next run', async () => {
    const { producer } = standIn();
    const { fetch, requests } = signals();
    assert.equal(await deliver(runtime(fetch).rt, producer), exitCodes.retryLater);
    assert.equal(requests.length, 5);
    assert.equal(pending(), requests[0]?.body);
  });

  it('ends the run at once when Retry-After is longer than it waits', async () => {
    const { producer } = standIn();
    const { fetch, requests } = signals({ status: 429, headers: { 'retry-after': '3600' } });
    assert.equal(await deliver(runtime(fetch).rt, producer), exitCodes.retryLater);
    assert.equal(requests.length, 1);
  });
});

describe('Retry-After across runs', () => {
  const minute = 60_000;
  const at = (ms: number, fetch: typeof globalThis.fetch) =>
    runtime(fetch, { now: () => now + ms });

  // Catches systemd's restart 15 minutes later resending while signals asked for an hour.
  it('sends nothing before the deadline signals gave, then the same bytes', async () => {
    const { producer, state } = standIn();
    const first = signals({ status: 429, headers: { 'retry-after': '3600' } });
    assert.equal(await deliver(at(0, first.fetch).rt, producer), exitCodes.retryLater);

    const restart = signals(accepted());
    const early = at(15 * minute, restart.fetch);
    assert.equal(await deliver(early.rt, producer), exitCodes.retryLater);
    assert.equal(restart.requests.length, 0);
    assert.match(early.logs.at(-1) ?? '', /"event":"retry_later"/);

    // Within the run's own wait of the deadline: it waits out the rest, then sends.
    const later = signals(accepted());
    const close = at(58 * minute, later.fetch);
    assert.equal(await deliver(close.rt, producer), exitCodes.ok);
    assert.deepEqual(close.waits, [2 * minute]);
    assert.equal(later.requests[0]?.body, first.requests[0]?.body);
    assert.equal(state.built, 1);

    // Acknowledged: the deadline is gone with the body.
    const next = signals(accepted());
    assert.equal(await deliver(at(59 * minute, next.fetch).rt, producer), exitCodes.ok);
    assert.equal(next.requests.length, 1);
    assert.deepEqual(readdirSync(stateDir), []);
  });

  it('keeps a long Retry-After from the last attempt for the next run', async () => {
    const { producer } = standIn();
    const first = signals(
      { status: 503 },
      { status: 503 },
      { status: 503 },
      { status: 503 },
      { status: 429, headers: { 'retry-after': '3600' } }
    );
    assert.equal(await deliver(at(0, first.fetch).rt, producer), exitCodes.retryLater);
    assert.equal(first.requests.length, 5);

    const restart = signals(accepted());
    assert.equal(await deliver(at(15 * minute, restart.fetch).rt, producer), exitCodes.retryLater);
    assert.equal(restart.requests.length, 0);
  });

  // Catches a new body taken as leave to send: Retry-After holds for the endpoint, not the body.
  it('keeps the deadline when a reboot supersedes the pending body', async () => {
    let rebooted = false;
    const { producer, state } = standIn({ supersedes: () => rebooted });
    const first = signals({ status: 429, headers: { 'retry-after': '3600' } });
    assert.equal(await deliver(at(0, first.fetch).rt, producer), exitCodes.retryLater);

    rebooted = true;
    const restart = signals(accepted());
    assert.equal(await deliver(at(15 * minute, restart.fetch).rt, producer), exitCodes.retryLater);
    assert.equal(restart.requests.length, 0);
    assert.equal(state.built, 2);
  });

  it('keeps the deadline when the pending body expires', async () => {
    const { producer, state } = standIn();
    const first = signals({ status: 429, headers: { 'retry-after': '3600' } });
    // The body was collected at `now`; signals asks for an hour when it is 22.5 hours old.
    const old = 22.5 * 60 * minute;
    assert.equal(await deliver(at(old, first.fetch).rt, producer), exitCodes.retryLater);

    const restart = signals(accepted());
    assert.equal(
      await deliver(at(old + 31 * minute, restart.fetch).rt, producer),
      exitCodes.retryLater
    );
    assert.equal(restart.requests.length, 0);
    assert.equal(state.built, 2);
  });

  // Catches a corrupt deadline read as "no deadline" and the body sent anyway.
  it('fails closed on a deadline file it cannot read', async () => {
    const { producer } = standIn();
    await deliver(
      at(0, signals({ status: 429, headers: { 'retry-after': '3600' } }).fetch).rt,
      producer
    );
    writeFileSync(join(stateDir, 'retry-after'), 'soon');
    const { fetch, requests } = signals(accepted());
    assert.equal(await deliver(at(2 * 60 * minute, fetch).rt, producer), exitCodes.operator);
    assert.equal(requests.length, 0);
  });
});

describe('restarts', () => {
  // Catches a crash before the body was written leaving anything behind.
  it('after a crash before persistence, the next run collects a new delivery', async () => {
    const crash = standIn({
      build: async () => {
        throw new Error('killed');
      },
    });
    assert.equal(await deliver(runtime(signals().fetch).rt, crash.producer), exitCodes.operator);
    assert.equal(pending(), undefined);

    const { producer, state } = standIn();
    assert.equal(await deliver(runtime(signals(accepted()).fetch).rt, producer), exitCodes.ok);
    assert.equal(state.built, 1);
  });

  // Catches a restart that builds a new delivery (new id) instead of resending the old one.
  it('after a crash mid-request, the next run resends the same bytes', async () => {
    const { producer, state } = standIn();
    const first = signals('hang');
    void deliver(runtime(first.fetch).rt, producer);
    await new Promise((resolve) => setImmediate(resolve));

    const second = signals(accepted());
    assert.equal(await deliver(runtime(second.fetch).rt, producer), exitCodes.ok);
    assert.equal(state.built, 1);
    assert.equal(second.requests[0]?.body, first.requests[0]?.body);
  });

  // Catches a lost acknowledgement turning into a second delivery.
  it('after signals accepted but the answer was lost, the resend is acknowledged and removed', async () => {
    const { producer, state } = standIn();
    const first = signals('hang');
    void deliver(runtime(first.fetch).rt, producer);
    await new Promise((resolve) => setImmediate(resolve));

    // signals has it already: the same bytes get 200, as a duplicate.
    const second = signals(accepted(200));
    assert.equal(await deliver(runtime(second.fetch).rt, producer), exitCodes.ok);
    assert.equal(state.built, 1);
    assert.equal(second.requests[0]?.body, first.requests[0]?.body);
    assert.equal(pending(), undefined);
  });

  // Catches a half-written temporary file replacing, or being read as, the delivery.
  it('after an interrupted write, resends the old complete body and clears the remains', async () => {
    const { producer } = standIn();
    await deliver(
      runtime(signals({ status: 503 }, { status: 503 }, 'network', 'network', 'network').fetch).rt,
      producer
    );
    const old = pending();
    writeFileSync(join(stateDir, 'pending.json.tmp-4242'), '{"producer":"desk');

    const { fetch, requests } = signals(accepted());
    assert.equal(await deliver(runtime(fetch).rt, producer), exitCodes.ok);
    assert.equal(requests[0]?.body, old);
    assert.deepEqual(readdirSync(stateDir), []);
  });

  // Catches corrupt state silently replaced by a new id, which would hide a bug or an edit.
  it('fails closed on a pending file it cannot read, and leaves it as it is', async () => {
    mkdirSync(stateDir, { recursive: true });
    for (const corrupt of [
      '{"producer":"desktop","deliveryId":',
      JSON.stringify({ producer: 'llm-usage', deliveryId: crypto.randomUUID(), sentAt: 'x' }),
    ]) {
      writeFileSync(pendingPath(), corrupt);
      const { producer, state } = standIn();
      const { fetch, requests } = signals(accepted());
      assert.equal(await deliver(runtime(fetch).rt, producer), exitCodes.operator);
      assert.equal(requests.length, 0);
      assert.equal(state.built, 0);
      assert.equal(pending(), corrupt);
    }
  });

  // Catches a body signals would refuse as over 24 h old being resent forever.
  it('rebuilds a pending delivery older than 23 hours with a new id', async () => {
    const { producer, state } = standIn();
    await deliver(
      runtime(signals('network', 'network', 'network', 'network', 'network').fetch).rt,
      producer
    );
    const old = JSON.parse(pending() ?? '{}') as Delivery;

    const { fetch, requests } = signals(accepted());
    const later = runtime(fetch, { now: () => now + maxPendingAgeMs + 1 });
    assert.equal(await deliver(later.rt, producer), exitCodes.ok);
    assert.equal(state.built, 2);
    assert.notEqual(JSON.parse(requests[0]?.body ?? '{}').deliveryId, old.deliveryId);
  });

  // Catches state left readable by others because it was created before this version.
  it('makes existing state private', async () => {
    mkdirSync(stateDir, { recursive: true, mode: 0o755 });
    chmodSync(stateDir, 0o755);
    const body = JSON.stringify({
      producer: 'desktop',
      deliveryId: crypto.randomUUID(),
      sentAt: new Date(now).toISOString(),
      payload: {},
    });
    writeFileSync(pendingPath(), body, { mode: 0o644 });
    chmodSync(pendingPath(), 0o644);
    let modes: number[] = [];
    const fetch = (async () => {
      modes = [statSync(stateDir).mode & 0o777, statSync(pendingPath()).mode & 0o777];
      return new Response('{"accepted":true}', { status: 202 });
    }) as typeof globalThis.fetch;

    await deliver(runtime(fetch).rt, standIn().producer);
    assert.deepEqual(modes, [0o700, 0o600]);
  });
});

describe('credentials', () => {
  const envFile = () => join(dir, 'signals.env');
  const write = (text: string, mode = 0o600) => {
    writeFileSync(envFile(), text, { mode });
    chmodSync(envFile(), mode);
  };

  // Catches another secret in the file being read, or the whole file sent as the token.
  it('reads only its own line of the env file', () => {
    write(
      `# comment\nLASTFM_API_KEY=${'l'.repeat(32)}\nPUSH_TOKEN_DESKTOP=${token}\nPUSH_TOKEN_LLM_USAGE=${'u'.repeat(40)}\n`
    );
    assert.equal(tokenFromEnvFile(envFile(), 'PUSH_TOKEN_DESKTOP'), token);
    assert.equal(tokenFromEnvFile(envFile(), 'PUSH_TOKEN_LLM_USAGE'), 'u'.repeat(40));
  });

  it('refuses a missing or short token, and a file others can read, naming no value', () => {
    write(`PUSH_TOKEN_LLM_USAGE=${'u'.repeat(40)}\nPUSH_TOKEN_DESKTOP=short\n`);
    assert.throws(
      () => tokenFromEnvFile(envFile(), 'PUSH_TOKEN_DESKTOP'),
      /^Error: token_missing$/
    );
    assert.throws(() => tokenFromEnvFile(envFile(), 'PUSH_TOKEN_TRELLIS'), /token_missing/);
    write(`PUSH_TOKEN_DESKTOP=${token}\n`, 0o644);
    assert.throws(
      () => tokenFromEnvFile(envFile(), 'PUSH_TOKEN_DESKTOP'),
      /credentials_not_private/
    );
    assert.throws(() => tokenFromEnvFile(join(dir, 'absent'), 'X'), /credentials_unreadable/);
  });
});

describe('modes', () => {
  const local = {
    MIN7_TEST_ENDPOINT: 'http://127.0.0.1:8787',
    MIN7_TEST_TOKEN: token,
    MIN7_STATE_DIR: '/tmp/x',
  };

  // Catches fixture data or a test token reaching production, or test settings half applied.
  it('allows fixtures only in a dry run or against a loopback endpoint', () => {
    assert.deepEqual(parseMode([], {}), { kind: 'production' });
    assert.equal(parseMode(['--dry-run', '--fixtures', 'f'], {}).kind, 'dry-run');
    assert.equal(parseMode(['--fixtures', 'f'], local).kind, 'local');
    for (const [argv, env] of [
      [['--fixtures', 'f'], {}],
      [['--dry-run'], {}],
      [['--dry-run', '--fixtures', 'f'], local],
      [['--fixtures', 'f'], { ...local, MIN7_TEST_ENDPOINT: 'https://api.ayagmar.dev' }],
      [['--fixtures', 'f'], { ...local, MIN7_TEST_ENDPOINT: 'http://127.0.0.1.evil.invalid:80' }],
      [['--fixtures', 'f'], { ...local, MIN7_TEST_TOKEN: '' }],
      [[], local],
      [['--endpoint', 'x'], {}],
    ] as const) {
      assert.throws(() => parseMode(argv, env), /usage/, JSON.stringify([argv, env]));
    }
  });
});

describe('command line', () => {
  /** signals on a loopback port, answering after `delayMs`. */
  async function server(delayMs: number) {
    const bodies: string[] = [];
    const srv = createServer((request, response) => {
      let body = '';
      request.on('data', (chunk) => {
        body += chunk;
      });
      request.on('end', () => {
        bodies.push(`${request.headers.authorization} ${body}`);
        setTimeout(() => {
          response.writeHead(202, { 'content-type': 'application/json' });
          response.end('{"accepted":true}');
        }, delayMs);
      });
    });
    await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', resolve));
    const { port } = srv.address() as { port: number };
    return { origin: `http://127.0.0.1:${port}`, bodies, close: () => srv.close() };
  }

  const run = (origin: string, fixtures: string) =>
    new Promise<{ code: number | null; out: string }>((resolve) => {
      const child = spawn(
        process.execPath,
        [join(import.meta.dirname, 'desktop.ts'), '--fixtures', fixtures],
        {
          // No session, no real HOME: a timer started before login looks like this.
          env: {
            PATH: process.env.PATH,
            HOME: dir,
            MIN7_TEST_ENDPOINT: origin,
            MIN7_TEST_TOKEN: token,
            MIN7_STATE_DIR: stateDir,
          },
        }
      );
      let out = '';
      child.stdout.on('data', (chunk) => {
        out += chunk;
      });
      child.on('close', (code) => resolve({ code, out }));
    });

  // Catches two runs (timer and manual) both sending, or one deleting the other's delivery.
  it('runs one invocation at a time per state directory', async () => {
    writeSamples(join(dir, 'samples'), Date.now());
    const signals = await server(1500);
    try {
      const results = await Promise.all([
        run(signals.origin, join(dir, 'samples', 'desktop')),
        run(signals.origin, join(dir, 'samples', 'desktop')),
      ]);
      assert.deepEqual(
        results.map((r) => r.code),
        [0, 0]
      );
      assert.equal(signals.bodies.length, 1);
      assert.ok(signals.bodies[0]?.startsWith(`Bearer ${token} {"producer":"desktop"`));
      assert.equal(results.filter((r) => r.out.includes('"event":"busy"')).length, 1);
      assert.equal(pending(), undefined);
    } finally {
      signals.close();
    }
  });
});
