// Every normalizer against every shared fixture case. A case with a snapshot fixture must
// normalize to exactly that snapshot (so no field outside the contract leaks through and
// none goes missing); a case without one must fail with a PullError of the listed code.
import { rawFixtures, snapshotFixtures } from '@min7/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { PullError, type PullErrorCode } from '../src/adapters/pull/index.ts';
import { listening, weekStart } from '../src/adapters/pull/listening.ts';
import { type ProjectsRaw, projects } from '../src/adapters/pull/projects.ts';
import { shipping } from '../src/adapters/pull/shipping.ts';

type Expected = { snapshot: unknown } | { error: PullErrorCode };

function check(normalize: () => unknown, expected: Expected) {
  if ('snapshot' in expected) {
    expect(normalize()).toEqual(expected.snapshot);
    return;
  }
  let thrown: unknown;
  try {
    normalize();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(PullError);
  expect(thrown).toMatchObject({ code: expected.error, message: expected.error });
}

describe('listening (Last.fm)', () => {
  const expected: Record<keyof typeof rawFixtures.lastfm, Expected> = {
    ok: { snapshot: snapshotFixtures.listening.ok },
    empty: { snapshot: snapshotFixtures.listening.empty },
    'single-item': { snapshot: snapshotFixtures.listening['single-item'] },
    partial: { snapshot: snapshotFixtures.listening.partial },
    'error-in-200': { error: 'upstream_rate_limited' },
    malformed: { error: 'upstream_malformed' },
    missing: { error: 'upstream_not_found' },
  };

  it.each(Object.entries(rawFixtures.lastfm))('normalizes the %s case', (name, raw) => {
    check(() => listening.normalize(raw), expected[name as keyof typeof expected]);
  });

  it('takes now playing only from the track Last.fm flags, and never lists it as played', () => {
    const snapshot = listening.normalize(rawFixtures.lastfm.ok);
    expect(snapshot.nowPlaying?.track).toBe('Friendships and Love');
    expect(snapshot.recent.map((track) => track.track)).not.toContain('Friendships and Love');
    // `nowplaying: "false"` is an ordinary scrobble.
    expect(listening.normalize(rawFixtures.lastfm.partial).nowPlaying).toBeNull();
  });

  it('starts weeks on Monday 00:00 UTC', () => {
    const monday = Date.UTC(2026, 9, 26) / 1000;
    expect(weekStart(new Date('2026-10-26T00:00:00Z'))).toBe(monday);
    expect(weekStart(new Date('2026-11-01T23:59:59Z'))).toBe(monday);
    expect(weekStart(new Date('2026-10-25T23:59:59Z'))).toBe(monday - 7 * 24 * 60 * 60);
  });
});

describe('shipping (repo-pulse)', () => {
  const expected: Record<keyof (typeof rawFixtures)['repo-pulse'], Expected> = {
    ok: { snapshot: snapshotFixtures.shipping.ok },
    empty: { snapshot: snapshotFixtures.shipping.empty },
    // An unknown event type, an unreadable timestamp and a stargazer's login are dropped.
    partial: { snapshot: snapshotFixtures.shipping.partial },
    malformed: { error: 'upstream_malformed' },
    // The feed is gone (404): no snapshot, so the site shows its empty state.
    missing: { error: 'upstream_not_found' },
  };

  it.each(Object.entries(rawFixtures['repo-pulse']))('normalizes the %s case', (name, raw) => {
    check(() => shipping.normalize(raw), expected[name as keyof typeof expected]);
  });
});

describe('projects (GitHub and npm)', () => {
  const raw = (name: keyof typeof rawFixtures.github): ProjectsRaw => ({
    github: rawFixtures.github[name],
    npm: rawFixtures.npm[name],
  });
  const expected: Record<keyof typeof rawFixtures.github, Expected> = {
    ok: { snapshot: snapshotFixtures.projects.ok },
    // Every repository deleted or private: nothing to show, but GitHub did answer.
    empty: { snapshot: snapshotFixtures.projects.empty },
    // Renamed, archived, no release, GitHub or npm failing for one project, zero downloads.
    partial: { snapshot: snapshotFixtures.projects.partial },
    malformed: { error: 'upstream_malformed' },
    // Unauthenticated GitHub refused every call.
    missing: { error: 'upstream_rate_limited' },
  };

  it.each(Object.keys(rawFixtures.github))('normalizes the %s case', (name) => {
    const key = name as keyof typeof expected;
    check(() => projects.normalize(raw(key)), expected[key]);
  });
});
