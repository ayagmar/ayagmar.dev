// Every normalizer against every shared fixture case. A case with a snapshot fixture must
// normalize to exactly that snapshot (so no field outside the contract leaks through and
// none goes missing); a case without one must fail with a PullError of the listed code.
import {
  type GithubProjectRepo,
  githubMergedPullSchema,
  githubReleaseNodeSchema,
  repoPulseActivityDaySchema,
} from '@min7/contracts';
import { rawFixtures, snapshotFixtures } from '@min7/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { PullError, type PullErrorCode } from '../src/adapters/pull/index.ts';
import { listening, weekStart } from '../src/adapters/pull/listening.ts';
import { monkeytype } from '../src/adapters/pull/monkeytype.ts';
import {
  projectEvents,
  readMergedPull,
  readReleaseNode,
} from '../src/adapters/pull/project-events.ts';
import { type ProjectsRaw, projects } from '../src/adapters/pull/projects.ts';
import { shipping } from '../src/adapters/pull/shipping.ts';
import { readActivityDay, shippingActivity } from '../src/adapters/pull/shipping-activity.ts';
import { weather } from '../src/adapters/pull/weather.ts';

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

describe('shipping-activity (repo-pulse daily activity)', () => {
  const expected: Record<keyof (typeof rawFixtures)['repo-pulse-activity'], Expected> = {
    ok: { snapshot: snapshotFixtures['shipping-activity'].ok },
    // Nothing recorded yet: a success that keeps no day.
    'since-null': { snapshot: snapshotFixtures['shipping-activity']['since-null'] },
    // The visibility gate left a repository unresolved: retried at the next run (ADR 0038).
    incomplete: { error: 'upstream_incomplete' },
    unavailable: { error: 'upstream_http_error' },
    malformed: { error: 'upstream_malformed' },
    missing: { error: 'upstream_not_found' },
  };

  it.each(Object.entries(rawFixtures['repo-pulse-activity']))(
    'normalizes the %s case',
    (name, raw) => {
      check(
        () =>
          shippingActivity
            .history(shippingActivity.normalize(raw))
            .merge({ snapshot: null, days: new Map() }).snapshot,
        expected[name as keyof typeof expected]
      );
    }
  );
});

// The adapter reads each day by hand, since zod in workerd is too slow for 400 of them. Catches
// a reader that stores what the contract refuses, or refuses what it accepts: every day of the
// fixtures, and cases at the edge of each check, against the contract's own schema.
describe('the activity day reader', () => {
  const day = {
    date: '2026-10-25',
    pushes: 4,
    commits: 19,
    merges: 12,
    releases: 0,
    stars: 3,
    repos: [
      { repo: 'ayagmar/ayagmar.dev', pushes: 4, commits: 19, merges: 12, releases: 0, stars: 3 },
    ],
    reposTruncated: false,
  };
  const repo = (change: object) => ({ ...day, repos: [{ ...day.repos[0], ...change }] });
  const edges: Record<string, unknown> = {
    'an unknown key': { ...day, reviews: 3 },
    'a repository with an unknown key': repo({ forks: 1 }),
    '30 February': { ...day, date: '2026-02-30' },
    'a leap day': { ...day, date: '2028-02-29' },
    'a date with a time': { ...day, date: '2026-10-25T00:00:00Z' },
    'a negative count': { ...day, merges: -1 },
    'a fraction': { ...day, merges: 1.5 },
    'a count as a string': { ...day, merges: '12' },
    'a count of 1,000,000': { ...day, merges: 1_000_000 },
    'a count over 1,000,000': { ...day, merges: 1_000_001 },
    'a missing count': { ...day, stars: undefined },
    'reposTruncated missing': { ...day, reposTruncated: undefined },
    'reposTruncated as a string': { ...day, reposTruncated: 'false' },
    'a repository name only': { ...day, repos: ['ayagmar/ayagmar.dev'] },
    'a repository without an owner': repo({ repo: 'ayagmar.dev' }),
    'a repository name of 101 characters': repo({ repo: `ayagmar/${'x'.repeat(101)}` }),
    'a repository with a negative count': repo({ stars: -1 }),
    '50 repositories': { ...day, repos: Array.from({ length: 50 }, () => day.repos[0]) },
    '51 repositories': { ...day, repos: Array.from({ length: 51 }, () => day.repos[0]) },
    'repos not a list': { ...day, repos: {} },
    'a list': [day],
    null: null,
  };
  const days = Object.values(rawFixtures['repo-pulse-activity']).flatMap((raw) =>
    Array.isArray((raw.body as { days?: unknown })?.days)
      ? ((raw.body as { days: unknown[] }).days as unknown[])
      : []
  );

  const agrees = (value: unknown) => {
    const parsed = repoPulseActivityDaySchema.safeParse(value);
    expect(readActivityDay(value)).toEqual(parsed.success ? parsed.data : null);
  };

  it.each(Object.entries(edges))('agrees with the contract on %s', (_case, value) => agrees(value));

  it('agrees with the contract on every day of the fixtures', () => {
    expect(days.length).toBeGreaterThan(400);
    for (const value of days) agrees(value);
  });
});

describe('project-events (GitHub GraphQL)', () => {
  const raw = rawFixtures['github-graphql'];
  const expected: Record<keyof typeof raw, Expected> = {
    ok: { snapshot: snapshotFixtures['project-events'].ok },
    // Deleted, private, moved away and renamed repositories; drafts, bots, a bad node, a URL
    // twice, a full page with an old PR updated today, a short page.
    partial: { snapshot: snapshotFixtures['project-events'].partial },
    // Every repository deleted or private: nothing to show, and GitHub did answer for each.
    empty: { snapshot: snapshotFixtures['project-events'].empty },
    // One repository GitHub failed to answer for: the whole pull fails (ADR 0046).
    unresolved: { error: 'upstream_error' },
    'rate-limited': { error: 'upstream_rate_limited' },
    missing: { error: 'upstream_unauthorized' },
    malformed: { error: 'upstream_malformed' },
  };

  it.each(Object.entries(raw))('normalizes the %s case', (name, answer) => {
    check(() => projectEvents.normalize(answer), expected[name as keyof typeof expected]);
  });

  const partial = projectEvents.normalize(raw.partial);
  const log = (slug: string) =>
    partial.projects
      .find((project) => project.slug === slug)
      ?.events.map((event) => (event.type === 'merge' ? event.number : event.tag));

  // Catches a log that names a repository GitHub would not show the public: deleted or private
  // (`NOT_FOUND` to a public-only token), private to a broader token, or moved to another account.
  it('leaves out repositories that are not public and the owner’s', () => {
    for (const slug of ['pi-mobile', 'kipple', 'dotfiles']) expect(log(slug)).toBeUndefined();
    expect(partial.projects.find((project) => project.slug === 'llm-usage-metrics')?.repo).toBe(
      'ayagmar/llm-usage'
    );
  });

  // Catches a merge window with a gap: GitHub orders merged PRs by update, so an old PR touched
  // today sits in a full page above months of merges that are not in it.
  it('lists no merge older than a full page reaches, and every one newer', () => {
    // #12, merged in March and updated today, would sit under these with months missing. The
    // bots' PRs still count toward the page, and github-actions' release PRs fill its end.
    expect(log('runnerd')).toEqual([100, 99, 97, 95, 93, 91, 89, 'v0.3.0', 'v0.2.0', 'v0.1.0']);
    // A short page is all there is, however old.
    expect(log('pi-extmgr')).toEqual([24, 23]);
  });

  // Catches dependency bumps and GitHub Actions' release PRs filling the log, GraphQL naming a
  // bot without `[bot]`, and a deleted account's PR dropped with them.
  it('leaves out bots, drafts, unreadable nodes and repeats', () => {
    expect(log('llm-usage-metrics')).toEqual([50, 'v2.0.0-rc.1', 46, 'v1.7.0']);
  });

  // Catches a batch of bot PRs emptying a log: on a repository without releases, 20 Dependabot
  // merges updated last must leave room in the page for the owner's merges behind them.
  it('shows the merges behind a batch of twenty bot PRs', () => {
    const merge = (number: number, login: string) => {
      const at = new Date(Date.UTC(2026, 10, 10, 0, number)).toISOString();
      return {
        number,
        title: `Change ${number}`,
        url: `https://github.com/ayagmar/kipple/pull/${number}`,
        mergedAt: at,
        updatedAt: at,
        author: { login },
      };
    };
    const body = structuredClone(raw.ok.body) as { data: { p_kipple: GithubProjectRepo } };
    body.data.p_kipple.pullRequests.nodes = [
      ...Array.from({ length: 20 }, (_, i) => merge(30 - i, 'dependabot')),
      ...Array.from({ length: 10 }, (_, i) => merge(10 - i, 'ayagmar')),
    ];
    const kipple = projectEvents
      .normalize({ ...raw.ok, body })
      .projects.find((project) => project.slug === 'kipple');
    expect(kipple?.events.map((event) => event.type === 'merge' && event.number)).toEqual([
      10, 9, 8, 7, 6, 5, 4, 3, 2, 1,
    ]);
  });

  // Catches merges crowding out releases on a busy repository: runnerd's 20 newest events on
  // 2026-11-11 were all merges, and its releases must still show.
  it('keeps ten releases and ten merges per project at most, each on its own', () => {
    const ok = projectEvents.normalize(raw.ok);
    const runnerd = ok.projects.find((project) => project.slug === 'runnerd')?.events ?? [];
    expect(runnerd.filter((event) => event.type === 'release')).toHaveLength(10);
    expect(runnerd.filter((event) => event.type === 'merge')).toHaveLength(10);
    for (const project of ok.projects) {
      const count = (type: string) => project.events.filter((event) => event.type === type).length;
      expect(count('release')).toBeLessThanOrEqual(10);
      expect(count('merge')).toBeLessThanOrEqual(10);
    }
  });
});

// Nodes are read by hand, since zod per node is too slow in workerd (ADR 0046). Catches a reader
// that stores what the contract refuses, or refuses what it accepts.
describe('the GitHub node readers', () => {
  const release = {
    tagName: 'v1.0.0',
    url: 'https://github.com/ayagmar/runnerd/releases/tag/v1.0.0',
    createdAt: '2026-11-10T12:00:00Z',
    publishedAt: '2026-11-10T12:01:00Z',
  };
  const merge = {
    number: 7,
    title: 'Keep jobs in order',
    url: 'https://github.com/ayagmar/runnerd/pull/7',
    mergedAt: '2026-11-10T12:00:00Z',
    updatedAt: '2026-11-10T12:00:05Z',
    author: { login: 'ayagmar' },
  };
  const releaseEdges: Record<string, unknown> = {
    ok: release,
    draft: { ...release, publishedAt: null },
    'extra key': { ...release, isDraft: false },
    'published missing': { ...release, publishedAt: undefined },
    'tag empty': { ...release, tagName: '' },
    'tag 200': { ...release, tagName: 'v'.repeat(200) },
    'tag 201': { ...release, tagName: 'v'.repeat(201) },
    'url off github': { ...release, url: 'https://example.com/v1.0.0' },
    'url with a space': { ...release, url: 'https://github.com/a b' },
    'url 2048': { ...release, url: `https://github.com/${'a'.repeat(2029)}` },
    'url 2049': { ...release, url: `https://github.com/${'a'.repeat(2030)}` },
    'time with offset': { ...release, createdAt: '2026-11-10T12:00:00+01:00' },
    'time with fraction': { ...release, createdAt: '2026-11-10T12:00:00.123Z' },
    'time without zone': { ...release, createdAt: '2026-11-10T12:00:00' },
    'not a date': { ...release, createdAt: '2026-02-30T12:00:00Z' },
    'a list': [release],
    null: null,
  };
  const mergeEdges: Record<string, unknown> = {
    ok: merge,
    ghost: { ...merge, author: null },
    'author missing': { ...merge, author: undefined },
    'author without login': { ...merge, author: {} },
    'login 101': { ...merge, author: { login: 'a'.repeat(101) } },
    'extra key in author': { ...merge, author: { login: 'ayagmar', url: 'https://github.com/x' } },
    'number zero': { ...merge, number: 0 },
    'number fractional': { ...merge, number: 1.5 },
    'number past safe': { ...merge, number: 2 ** 53 },
    'number as text': { ...merge, number: '7' },
    'title 300': { ...merge, title: 't'.repeat(300) },
    'title 301': { ...merge, title: 't'.repeat(301) },
    'title empty': { ...merge, title: '' },
    'merged missing': { ...merge, mergedAt: null },
    'updated missing': { ...merge, updatedAt: undefined },
  };
  const nodes = Object.values(rawFixtures['github-graphql']).flatMap(({ body }) =>
    Object.values((body as { data?: Record<string, unknown> | null }).data ?? {}).flatMap(
      (repo) => {
        const { releases, pullRequests } = (repo ?? {}) as {
          releases?: { nodes?: unknown };
          pullRequests?: { nodes?: unknown };
        };
        return [
          ...(Array.isArray(releases?.nodes)
            ? releases.nodes.map((node) => ['release', node] as const)
            : []),
          ...(Array.isArray(pullRequests?.nodes)
            ? pullRequests.nodes.map((node) => ['merge', node] as const)
            : []),
        ];
      }
    )
  );

  const agrees = (kind: 'release' | 'merge', value: unknown) => {
    const parsed = (
      kind === 'release' ? githubReleaseNodeSchema : githubMergedPullSchema
    ).safeParse(value);
    const read = kind === 'release' ? readReleaseNode(value) : readMergedPull(value);
    expect(read).toEqual(parsed.success ? parsed.data : null);
  };

  it.each(Object.entries(releaseEdges))('reads a release as the contract on %s', (_, value) =>
    agrees('release', value)
  );
  it.each(Object.entries(mergeEdges))('reads a merge as the contract on %s', (_, value) =>
    agrees('merge', value)
  );
  it('reads every node of the fixtures as the contract', () => {
    expect(nodes.length).toBeGreaterThan(250);
    for (const [kind, value] of nodes) agrees(kind, value);
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

describe('weather (Open-Meteo)', () => {
  const expected: Record<keyof (typeof rawFixtures)['open-meteo'], Expected> = {
    // Real, Rabat on 2026-10-26: overcast.
    ok: { snapshot: snapshotFixtures.weather.ok },
    clear: { snapshot: snapshotFixtures.weather.clear },
    fog: { snapshot: snapshotFixtures.weather.fog },
    rain: { snapshot: snapshotFixtures.weather.rain },
    snow: { snapshot: snapshotFixtures.weather.snow },
    storm: { snapshot: snapshotFixtures.weather.storm },
    // A code Open-Meteo does not document is still served; the site shows no weather for it.
    'unknown-code': { snapshot: snapshotFixtures.weather['unknown-code'] },
    // Values the model had none for, null or left out, stay null rather than becoming 0.
    partial: { snapshot: snapshotFixtures.weather.partial },
    // No weather code: no current conditions, so the last snapshot stays.
    empty: { error: 'upstream_error' },
    // Fahrenheit, and the code as a string.
    malformed: { error: 'upstream_malformed' },
    // 429: over the free API's limits.
    missing: { error: 'upstream_rate_limited' },
  };

  it.each(Object.entries(rawFixtures['open-meteo']))('normalizes the %s case', (name, raw) => {
    check(() => weather.normalize(raw), expected[name as keyof typeof expected]);
  });

  // Catches a falsy check that takes code 0 (clear sky) or is_day 0 for a missing value.
  it('keeps code 0 and is_day 0, and fails only on a null code', () => {
    const raw = structuredClone(rawFixtures['open-meteo'].ok);
    Object.assign(raw.body.current, { temperature_2m: null, is_day: 0, weather_code: 0 });
    expect(weather.normalize(raw)).toMatchObject({
      temperatureC: null,
      isDay: false,
      weatherCode: 0,
    });
    raw.body.current.weather_code = null as unknown as number;
    check(() => weather.normalize(raw), { error: 'upstream_error' });
  });

  // Catches a range on the code: a failed pull keeps the last snapshot, so a new code past 99
  // would keep showing yesterday's rain instead of clearing the window.
  it('serves any whole code, and fails on a fractional one', () => {
    const raw = structuredClone(rawFixtures['open-meteo'].ok);
    raw.body.current.weather_code = 100;
    expect(weather.normalize(raw)).toMatchObject({ weatherCode: 100 });
    raw.body.current.weather_code = 3.5;
    check(() => weather.normalize(raw), { error: 'upstream_malformed' });
  });
});

describe('monkeytype (personal bests)', () => {
  const expected: Record<keyof typeof rawFixtures.monkeytype, Expected> = {
    // Real, minimized: time bests at 15, 30 and 60 seconds, no word-count bests (`data: null`).
    ok: { snapshot: snapshotFixtures.monkeytype.ok },
    // A new account: `data: null` and an empty map are both no bests, every slot null.
    empty: { snapshot: snapshotFixtures.monkeytype.empty },
    // Other wordlists, difficulties and flags, empty and absent lengths, a custom length, ties.
    partial: { snapshot: snapshotFixtures.monkeytype.partial },
    // Ids, a name, an email and new fields beside the data and in a best: none comes through.
    'sensitive-fields': { snapshot: snapshotFixtures.monkeytype['sensitive-fields'] },
    // WPM as a string.
    malformed: { error: 'upstream_malformed' },
    // 470: the ApeKey is not valid. Words was never asked.
    missing: { error: 'upstream_unauthorized' },
  };

  it.each(Object.entries(rawFixtures.monkeytype))('normalizes the %s case', (name, raw) => {
    check(() => monkeytype.normalize(raw), expected[name as keyof typeof expected]);
  });

  type Best = { [key: string]: unknown };
  const sixty = { wpm: 100, acc: 95, raw: 102, consistency: 80, timestamp: 1_700_000_000_000 };
  const english = { ...sixty, language: 'english', difficulty: 'normal' };
  const answer = (sixtySeconds: unknown, status = 200) => ({
    time: { status, body: { message: 'ok', data: { '60': sixtySeconds } } },
    words: { status: 200, body: { message: 'ok', data: null } },
  });
  const sixtyOf = (records: Best[]) => monkeytype.normalize(answer(records)).time[60];

  // Catches a strict `=== false` that drops bests saved before Monkeytype stored these flags,
  // and a truthy check that lets punctuation, numbers or lazy mode in.
  it('reads an absent flag as off, and leaves out any best with a flag on', () => {
    expect(sixtyOf([english])).toMatchObject({ wpm: 100, date: '2023-11-14' });
    for (const flag of ['punctuation', 'numbers', 'lazyMode']) {
      expect(sixtyOf([{ ...english, [flag]: true }]), flag).toBeNull();
      expect(sixtyOf([{ ...english, [flag]: false }]), flag).toMatchObject({ wpm: 100 });
    }
    // Only the English wordlist at normal difficulty; a missing language is not English.
    expect(sixtyOf([{ ...english, language: 'english_1k' }])).toBeNull();
    expect(sixtyOf([{ ...english, difficulty: 'master' }])).toBeNull();
  });

  // Catches numbers taken from different records, or a tie broken by array order.
  it('takes every number from the one best record, ties broken the same way in any order', () => {
    const a = { ...english, wpm: 110, acc: 90, raw: 120, consistency: 60 };
    const b = { ...english, wpm: 105, acc: 99, raw: 130, consistency: 90 };
    expect(sixtyOf([a, b])).toEqual({
      wpm: 110,
      acc: 90,
      raw: 120,
      consistency: 60,
      date: '2023-11-14',
    });
    const older = { ...english, timestamp: 1_600_000_000_000 };
    for (const records of [
      [english, older],
      [older, english],
    ]) {
      expect(sixtyOf(records)).toMatchObject({ date: '2023-11-14' });
    }
  });

  // Catches a value read as no best, or a timestamp read as seconds.
  it.each([
    ['WPM below 0', { ...english, wpm: -1 }],
    ['accuracy over 100', { ...english, acc: 100.01 }],
    ['consistency as a string', { ...english, consistency: '80' }],
    ['a fractional timestamp', { ...english, timestamp: 1.5 }],
    ['a timestamp past year 9999', { ...english, timestamp: 253_402_300_800_000 }],
    ['no language', { ...sixty, difficulty: 'normal' }],
    ['a null flag', { ...english, punctuation: null }],
    ['a flag as a string', { ...english, lazyMode: 'false' }],
  ])('fails on %s', (_case, record) => {
    check(() => sixtyOf([record as Best]), { error: 'upstream_malformed' });
  });

  // Catches the docs' example shape, a single best in `data`, read as an account with none.
  it('fails on an answer that is not a map of test lengths', () => {
    check(
      () =>
        monkeytype.normalize({ ...answer(null), time: { status: 200, body: { data: english } } }),
      {
        error: 'upstream_malformed',
      }
    );
    check(() => monkeytype.normalize(answer({ wpm: 100 })), { error: 'upstream_malformed' });
  });

  it('does not read a test length it does not show', () => {
    const raw = answer([english]);
    Object.assign(raw.time.body.data, { '45': [{ wpm: 'not read' }] });
    expect(monkeytype.normalize(raw).time[60]).toMatchObject({ wpm: 100 });
  });

  // Catches a refused key read as rate limiting (or the reverse), and 479's Retry-After lost.
  it.each([
    [401, 'upstream_unauthorized'],
    [403, 'upstream_unauthorized'],
    [470, 'upstream_unauthorized'],
    [471, 'upstream_unauthorized'],
    [472, 'upstream_unauthorized'],
    [429, 'upstream_rate_limited'],
    [479, 'upstream_rate_limited'],
    [301, 'upstream_http_error'],
    [500, 'upstream_http_error'],
    [503, 'upstream_http_error'],
  ] as const)('reads HTTP %i as %s', (status, code) => {
    const retryAt = Date.now() + 60_000;
    const refused = { status, body: { message: 'no' }, retryAt };
    for (const raw of [
      { time: refused, words: null },
      { time: answer([english]).time, words: refused },
    ]) {
      let thrown: unknown;
      try {
        monkeytype.normalize(raw);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toMatchObject({
        code,
        retryAt: code === 'upstream_rate_limited' ? retryAt : undefined,
      });
    }
  });
});
