// The build-time reader against a mocked signals API: whatever the API does, a read resolves
// to an envelope the pages can render, and the build never fails on source data.

import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fixturesCapturedAt, snapshotFixtures } from '@min7/contracts/fixtures';
import { fixtureEnvelope } from '@min7/contracts/testing';
import { delay, HttpResponse, http, passthrough } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createReader } from '../src/data/reader.ts';

const apiBase = 'https://api.test.invalid';
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const now = new Date('2026-10-26T12:00:00Z');

function reader(timeoutMs = 1_000) {
  const warnings: string[] = [];
  const read = createReader({
    mode: 'api',
    apiBase,
    timeoutMs,
    now: () => now,
    warn: (message) => warnings.push(message),
  }).read;
  return { read, warnings };
}

const empty = { source: 'projects', version: 1, fetchedAt: null, stale: true, data: null };

describe('api mode', () => {
  it('returns a valid envelope as served', async () => {
    const envelope = fixtureEnvelope('projects', '2026-10-26T11:00:00Z');
    server.use(http.get(`${apiBase}/v1/projects`, () => HttpResponse.json(envelope)));
    const { read, warnings } = reader();

    expect(await read('projects')).toEqual(envelope);
    expect(warnings).toEqual([]);
  });

  it('recomputes stale at build time, whatever the API said', async () => {
    // Fresh when served, but the listening threshold is 15 minutes and this is 3 hours old.
    const envelope = fixtureEnvelope('listening', '2026-10-26T09:00:00Z');
    server.use(http.get(`${apiBase}/v1/listening`, () => HttpResponse.json(envelope)));

    const read = await reader().read('listening');
    expect(read.stale).toBe(true);
  });

  it('passes a source that never succeeded through as empty', async () => {
    server.use(http.get(`${apiBase}/v1/projects`, () => HttpResponse.json(empty)));
    const { read, warnings } = reader();

    expect(await read('projects')).toEqual(empty);
    expect(warnings).toEqual([]);
  });

  it.each([
    [
      'answers 500',
      () => HttpResponse.json({ error: 'internal_error' }, { status: 500 }),
      /HTTP 500/,
    ],
    ['answers HTML', () => HttpResponse.text('<html>Bad gateway</html>'), /not JSON/],
    [
      'breaks the contract',
      () =>
        HttpResponse.json({
          ...fixtureEnvelope('projects', '2026-10-26T11:00:00Z'),
          data: { projects: [{ name: 'no repo' }] },
        }),
      /does not match the contract/,
    ],
    [
      'answers for another source',
      () => HttpResponse.json({ ...empty, source: 'listening' }),
      /does not match the contract/,
    ],
    ['is unreachable', () => HttpResponse.error(), /unavailable/],
  ])('renders the empty state when the API %s', async (_case, respond, reason) => {
    server.use(http.get(`${apiBase}/v1/projects`, respond));
    const { read, warnings } = reader();

    expect(await read('projects')).toEqual(empty);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(reason);
    // The warning names the failure, never what the API sent.
    expect(warnings[0]).not.toMatch(/Bad gateway|no repo/);
  });

  it('gives up on a read after the deadline', async () => {
    server.use(
      http.get(`${apiBase}/v1/projects`, async () => {
        await delay('infinite');
      })
    );
    const { read, warnings } = reader(50);

    expect(await read('projects')).toEqual(empty);
    expect(warnings[0]).toMatch(/no answer within 50 ms/);
  });

  it('gives up on a body that stalls after the headers', async () => {
    // A real local server: MSW's Node interceptor cannot abort a body mid-stream.
    const stalling = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.write('{"source":');
    });
    await new Promise<void>((resolve) => stalling.listen(0, '127.0.0.1', resolve));
    const { port } = stalling.address() as AddressInfo;
    const local = `http://127.0.0.1:${port}`;
    server.use(http.get(`${local}/v1/projects`, () => passthrough()));
    try {
      const read = createReader({
        mode: 'api',
        apiBase: local,
        timeoutMs: 50,
        warn: () => {},
      }).read;
      expect(await read('projects')).toEqual(empty);
    } finally {
      stalling.closeAllConnections();
      stalling.close();
    }
  });

  it('asks the API once per source per build', async () => {
    let calls = 0;
    server.use(
      http.get(`${apiBase}/v1/shipping`, () => {
        calls += 1;
        return HttpResponse.json(fixtureEnvelope('shipping', '2026-10-26T11:00:00Z'));
      })
    );
    const { read } = reader();

    await Promise.all([read('shipping'), read('shipping'), read('shipping')]);
    expect(calls).toBe(1);
  });
});

describe('fixtures mode', () => {
  // Fixtures mode builds the public Previews; e2e checks the pages label it as sample data.
  it('serves the ok fixtures, dated when they were captured', async () => {
    const read = createReader({ mode: 'fixtures', apiBase, now: () => now }).read;

    const listening = await read('listening');
    expect(listening.data).toEqual(snapshotFixtures.listening.ok);
    expect(listening.fetchedAt).toBe(fixturesCapturedAt);
  });
});
