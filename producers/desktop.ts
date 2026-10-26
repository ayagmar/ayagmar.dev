#!/usr/bin/env node
// The desktop facts producer (ADR 0032): the running kernel, the installed niri version and
// the boot time, pushed to POST /v1/push/desktop. Each value is held to an allowlist here and
// again by signals; a value outside it is sent as null, never as the raw string.
// Usage: desktop.ts | desktop.ts --dry-run --fixtures <dir> (see delivery.ts for a local run)
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { release } from 'node:os';
import { join } from 'node:path';
import { cli, type Delivery, exitCodes, type Producer, ProducerError } from './delivery.ts';

// The same patterns as packages/contracts/src/desktop.ts; a test keeps them equal.
export const kernelReleasePattern =
  /^\d{1,2}\.\d{1,3}\.\d{1,3}-(?:arch\d{1,2}-\d{1,3}|\d{1,3}-lts|zen\d{1,2}-\d{1,3}-zen|hardened\d{1,2}-\d{1,3}-hardened)$/;
export const niriVersionPattern = /^\d{2}\.\d{2}(?:\.\d{1,2})?$/;

/** Where the facts come from: this machine, or fixture files for tests and dry runs. */
export interface DesktopSources {
  /** `uname -r`. */
  kernelRelease(): string;
  /** The first line `niri --version` prints, or null when niri cannot be run. */
  niriVersion(): string | null;
  /** The contents of /proc/stat. */
  procStat(): string;
}

export const machineSources: DesktopSources = {
  kernelRelease: release,
  niriVersion() {
    try {
      // stderr is never read: only the version line is kept, and only if it parses.
      return execFileSync('niri', ['--version'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 10_000,
        maxBuffer: 4096,
      });
    } catch {
      return null;
    }
  },
  procStat: () => readFileSync('/proc/stat', 'utf8'),
};

/** Files `kernel-release`, `niri-version` (absent: niri not installed) and `proc-stat`. */
export function fixtureSources(dir: string): DesktopSources {
  const read = (name: string) => readFileSync(join(dir, name), 'utf8');
  return {
    kernelRelease: () => read('kernel-release').trim(),
    niriVersion() {
      try {
        return read('niri-version');
      } catch {
        return null;
      }
    },
    procStat: () => read('proc-stat'),
  };
}

/** The boot time from `btime` in /proc/stat, as a UTC instant. */
export function bootedAt(procStat: string): string {
  const seconds = /^btime (\d{1,12})$/m.exec(procStat)?.[1];
  if (seconds === undefined) throw new ProducerError('boot_time_unreadable', exitCodes.operator);
  return new Date(Number(seconds) * 1000).toISOString();
}

/** The niri release from `niri 26.04 (8ed0da4)`, without the commit; null for anything else. */
export function niriRelease(output: string | null): string | null {
  const version = /^niri (\S+)(?: \([^\n]*\))?\n?$/.exec(output ?? '')?.[1];
  return version !== undefined && version.length <= 8 && niriVersionPattern.test(version)
    ? version
    : null;
}

/** An official Arch kernel release as it is, null for anything else (a custom build). */
export const kernelRelease = (value: string) =>
  value.length <= 48 && kernelReleasePattern.test(value) ? value : null;

export function desktopProducer(sources: DesktopSources, now: () => number = Date.now): Producer {
  return {
    id: 'desktop',
    async build(): Promise<Delivery> {
      const sentAt = now();
      const booted = bootedAt(sources.procStat());
      if (Date.parse(booted) > sentAt) {
        throw new ProducerError('boot_time_in_future', exitCodes.dataError);
      }
      return {
        producer: 'desktop',
        deliveryId: crypto.randomUUID(),
        sentAt: new Date(sentAt).toISOString(),
        payload: {
          kernel: kernelRelease(sources.kernelRelease()),
          niri: niriRelease(sources.niriVersion()),
          bootedAt: booted,
        },
      };
    },
    // A pending snapshot from before the last boot would publish an old boot time as new.
    supersedes: (pending) =>
      (pending.payload as { bootedAt?: unknown }).bootedAt !== bootedAt(sources.procStat()),
  };
}

if (import.meta.main) {
  process.exitCode = await cli('desktop', 'PUSH_TOKEN_DESKTOP', (fixtures) =>
    desktopProducer(fixtures === null ? machineSources : fixtureSources(fixtures))
  );
}
