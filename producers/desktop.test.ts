// The desktop facts producer (ADR 0032): what it reads, what it refuses to send, and what it
// does with a delivery from before a reboot. Readings are invented; nothing reads this host.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import * as contract from '../packages/contracts/src/desktop.ts';
import { desktopPushSchema } from '../packages/contracts/src/index.ts';
import { deliver, exitCodes, type Runtime } from './delivery.ts';
import {
  bootedAt,
  type DesktopSources,
  desktopProducer,
  kernelRelease,
  kernelReleasePattern,
  niriRelease,
  niriVersionPattern,
} from './desktop.ts';

const now = Date.parse('2026-10-26T12:00:00Z');
const btime = (time: number) => `cpu 1 2 3\nbtime ${Math.floor(time / 1000)}\nprocesses 9\n`;

const sources = (overrides: Partial<DesktopSources> = {}): DesktopSources => ({
  kernelRelease: () => '7.2.11-arch1-1',
  niriVersion: () => 'niri 26.04 (8ed0da4)\n',
  procStat: () => btime(now - 3 * 86_400_000),
  ...overrides,
});

// The producer runs installed, without the repo, so it keeps its own copy of the patterns.
it('holds the same value allowlists as the contract', () => {
  assert.equal(kernelReleasePattern.source, contract.kernelReleasePattern.source);
  assert.equal(niriVersionPattern.source, contract.niriVersionPattern.source);
});

describe('readings', () => {
  // Catches a custom kernel's local suffix (a user or host name) being published.
  it('keeps official Arch kernel releases and nothing else', () => {
    for (const ok of [
      '7.2.11-arch1-1',
      '6.12.20-1-lts',
      '6.13.7-zen1-1-zen',
      '6.12.19-hardened1-1-hardened',
    ]) {
      assert.equal(kernelRelease(ok), ok);
    }
    for (const bad of [
      '7.2.11-arch1-1-ayagmar',
      '7.2.11-custom',
      '7.2.11-arch1-1 ',
      '/boot/vmlinuz',
      '',
    ]) {
      assert.equal(kernelRelease(bad), null, bad);
    }
  });

  // Catches the commit hash or a dirty build string being sent with the version.
  it('takes the niri release number without its commit', () => {
    assert.equal(niriRelease('niri 26.04 (8ed0da4)\n'), '26.04');
    assert.equal(niriRelease('niri 25.05.1\n'), '25.05.1');
    for (const bad of [
      'niri 26.04-dirty (x)\n',
      'niri git-main\n',
      'niri 26.04\nextra\n',
      'error: no socket',
      null,
    ]) {
      assert.equal(niriRelease(bad), null, String(bad));
    }
  });

  it('reads the boot time from btime as a UTC instant', () => {
    assert.equal(bootedAt('cpu 1\nbtime 1792741272\n'), '2026-10-23T07:41:12.000Z');
    assert.throws(() => bootedAt('cpu 1\n'), /boot_time_unreadable/);
  });
});

describe('the body', () => {
  // Catches a private-looking value in a permitted field reaching the wire.
  it('sends null for readings outside the allowlists, and passes the contract', async () => {
    const delivery = await desktopProducer(
      sources({
        kernelRelease: () => '7.2.11-arch1-1-owner-private-host',
        niriVersion: () => 'niri /home/owner/niri (dirty)\n',
      }),
      () => now
    ).build();
    const text = JSON.stringify(delivery);

    assert.deepEqual(delivery.payload, {
      kernel: null,
      niri: null,
      bootedAt: '2026-10-23T12:00:00.000Z',
    });
    assert.ok(!/owner|home|dirty/.test(text));
    assert.equal(desktopPushSchema.safeParse(delivery).error, undefined);
  });

  it('builds a body the contract accepts from good readings', async () => {
    const delivery = await desktopProducer(sources(), () => now).build();
    assert.equal(desktopPushSchema.safeParse(delivery).error, undefined);
    assert.deepEqual(delivery.payload, {
      kernel: '7.2.11-arch1-1',
      niri: '26.04',
      bootedAt: '2026-10-23T12:00:00.000Z',
    });
  });

  // Catches a clock error turned into a negative uptime on the site.
  it('sends nothing when the boot time is after now', async () => {
    const producer = desktopProducer(sources({ procStat: () => btime(now + 60_000) }), () => now);
    await assert.rejects(producer.build(), /boot_time_in_future/);
  });
});

describe('after a reboot', () => {
  let stateDir: string;
  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'min7-desktop-'));
  });
  afterEach(() => rmSync(stateDir, { recursive: true, force: true }));

  const runtime = (fetch: typeof globalThis.fetch): Runtime => ({
    endpoint: 'http://127.0.0.1:1/v1/push/desktop',
    token: 'test-desktop-token-000000000000000000',
    stateDir,
    fetch,
    now: () => now,
    sleep: async () => {},
    random: () => 0,
    log: () => {},
  });

  // Catches yesterday's undelivered boot time being published as current after a reboot.
  it('retires a pending delivery from the previous boot and sends the new boot time', async () => {
    let boot = now - 3 * 86_400_000;
    const producer = desktopProducer(sources({ procStat: () => btime(boot) }), () => now);
    const down = (async () => {
      throw new TypeError('offline');
    }) as typeof globalThis.fetch;
    assert.equal(await deliver(runtime(down), producer), exitCodes.retryLater);
    const before = JSON.parse(readFileSync(join(stateDir, 'pending.json'), 'utf8'));

    boot = now - 60_000;
    const sent: string[] = [];
    const up = (async (_url: string, init: RequestInit) => {
      sent.push(String(init.body));
      return new Response('{"accepted":true}', { status: 202 });
    }) as typeof globalThis.fetch;
    assert.equal(await deliver(runtime(up), producer), exitCodes.ok);

    const after = JSON.parse(sent[0] ?? '{}');
    assert.equal(sent.length, 1);
    assert.notEqual(after.deliveryId, before.deliveryId);
    assert.equal(after.payload.bootedAt, new Date(boot - (boot % 1000)).toISOString());
  });
});
