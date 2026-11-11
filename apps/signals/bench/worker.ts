// The CPU bench Worker (`just signals-cpu`, ADR 0030): runs one real cron invocation of a
// pull adapter, D1 included, with every upstream answered from memory, so the CPU it takes is
// signals' own work. Never deployed; scripts/signals-cpu.ts drives it.
import { featuredProjects, projectMergesAsked } from '@min7/contracts';
import { rawFixtures, snapshotFixtures } from '@min7/contracts/fixtures';
import { listening } from '../src/adapters/pull/listening.ts';
import { readListeningDay } from '../src/adapters/pull/listening-days.ts';
import { listeningHistory } from '../src/adapters/pull/listening-history.ts';
import { monkeytype } from '../src/adapters/pull/monkeytype.ts';
import { projectAlias, projectEvents } from '../src/adapters/pull/project-events.ts';
import { shippingActivity } from '../src/adapters/pull/shipping-activity.ts';
import { weather } from '../src/adapters/pull/weather.ts';
import type { PullAdapter } from '../src/adapters/types.ts';
import { runScheduled } from '../src/cron/run.ts';

/** Scrobbles as Last.fm sends them, with the image, MBID, album and URL fields the
 * fixtures leave out: about 720 B each, like the real pages captured on 2026-10-26. */
const fullScrobble = (artist: string, name: string, uts: number) => ({
  artist: { mbid: 'f1a2b3c4-d5e6-4f70-8192-a3b4c5d6e7f8', '#text': artist },
  streamable: '0',
  image: ['small', 'medium', 'large', 'extralarge'].map((size) => ({
    size,
    '#text': `https://lastfm.freetls.fastly.net/i/u/${size === 'small' ? '34s' : '64s'}/2a96cbd8b46e442fc41c2b86b821562f.jpg`,
  })),
  mbid: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
  album: { mbid: '', '#text': `${name} (Deluxe Edition)` },
  name,
  url: `https://www.last.fm/music/${encodeURIComponent(artist)}/_/${encodeURIComponent(name)}`,
  date: { uts: String(uts), '#text': '26 Oct 2025, 14:05' },
});

// The bench's own Rabat calendar, so preparing answers does not warm the adapter's.
const format = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Africa/Casablanca',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const dateAt = (seconds: number) => {
  const { year, month, day } = Object.fromEntries(
    format.formatToParts(seconds * 1000).map((p) => [p.type, p.value])
  );
  return `${year}-${month}-${day}`;
};
const startOf = (date: string) => {
  const [y = 0, m = 0, d = 0] = date.split('-').map(Number);
  let low = Date.UTC(y, m - 1, d) / 1000 - 3 * 3600;
  let high = low + 6 * 3600;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (dateAt(middle) >= date) high = middle;
    else low = middle + 1;
  }
  return low;
};
const after = (date: string) => {
  const [y = 0, m = 0, d = 0] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
};

/** Last.fm's answers for one scenario, by request: method, then from/to/page. */
type Answers = Map<string, string>;

const page = (n: number, total: number, tracks: unknown[]) =>
  JSON.stringify({
    recenttracks: {
      track: tracks,
      '@attr': {
        user: 'min7_',
        totalPages: String(Math.ceil(total / 200)),
        page: String(n),
        perPage: '200',
        total: String(total),
      },
    },
  });

/**
 * History answers for today's date: `perYear` scrobbles (at most 200, one page) in each of
 * `years` past years, the real `ok` fixture's tracks reused in turn.
 */
function historyAnswers(years: number, perYear: number): Answers {
  const today = dateAt(Date.now() / 1000);
  const thisYear = Number(today.slice(0, 4));
  const names = rawFixtures['lastfm-history'].ok.days.flatMap((d) =>
    d.page.body.recenttracks.track.map((t) => [t.artist['#text'], t.name])
  );
  const answers: Answers = new Map([
    [
      'user.getinfo',
      JSON.stringify({
        user: { registered: { unixtime: String(Date.UTC(thisYear - years, 0, 2) / 1000) } },
      }),
    ],
  ]);
  for (let year = thisYear - 1; year >= thisYear - years; year--) {
    const date = `${year}${today.slice(4)}`;
    const from = startOf(date);
    const to = startOf(after(date));
    const step = Math.floor((to - from) / (perYear + 1));
    const scrobbles = Array.from({ length: perYear }, (_, i) => {
      const [artist = '', name = ''] = names[i % names.length] ?? [];
      return fullScrobble(artist, name, to - 1 - i * step);
    });
    answers.set(`user.getrecenttracks ${from} ${to} 1`, page(1, perYear, scrobbles));
  }
  return answers;
}

/** The real listening fixture (it keeps Last.fm's full fields), by request. */
function listeningAnswers(): Answers {
  const ok = rawFixtures.lastfm.ok;
  return new Map([
    ['user.getrecenttracks', JSON.stringify(ok.recentTracks.body)],
    ['user.gettopartists', JSON.stringify(ok.topArtists.body)],
    ['user.getrecenttracks week', JSON.stringify(ok.thisWeek.body)],
  ]);
}

/** Today and yesterday in Rabat. */
function dayDates() {
  const today = dateAt(Date.now() / 1000);
  return [dateAt(startOf(today) - 1), today];
}

/** A day's range answer: one full scrobble and the track playing now on top. */
const dayAnswer = (date: string) =>
  JSON.stringify({
    recenttracks: {
      track: [
        { ...fullScrobble('LTN', 'Playing', 0), date: undefined, '@attr': { nowplaying: 'true' } },
        fullScrobble('LTN', 'Nowhere to Run', startOf(date) + 60),
      ],
      '@attr': { user: 'min7_', page: '1', perPage: '1', totalPages: '41', total: '41' },
    },
  });

/** `listeningAnswers`, and the two dates a pull in the hourly window reads. */
function listeningDayAnswers(): Answers {
  const answers = listeningAnswers();
  for (const date of dayDates()) answers.set(`day ${startOf(date)}`, dayAnswer(date));
  return answers;
}

/** The listening pull inside its hourly window, whatever the time the bench runs at. */
const listeningInWindow: typeof listening = {
  ...listening,
  async fetch(env, signal) {
    const raw = await listening.fetch(env, signal);
    if (raw.days !== undefined) return raw;
    const key = env.LASTFM_API_KEY;
    return {
      ...raw,
      days: await Promise.all(dayDates().map((date) => readListeningDay(date, key, signal))),
    };
  },
};

/** The date a backfill scenario reads: the real archive answer's. */
const backfillDate = '2026-11-04';

/** One date of a backfill: Last.fm's range and the real archive answer, as they come. */
const backfillAnswers = (): Answers =>
  new Map([
    [`day ${startOf(backfillDate)}`, dayAnswer(backfillDate)],
    ['archive', JSON.stringify(rawFixtures['open-meteo-archive'].ok.body)],
  ]);

/**
 * Monkeytype's answers near the adapter's 128 KiB cap (ADR 0033): in each mode, the four
 * standard lengths and six custom ones, each with 40 bests across wordlists, difficulties and
 * flags, about 200 B each, 2 standard ones among them.
 */
function monkeytypeAnswers(): Answers {
  const languages = ['english', 'english_1k', 'english_10k', 'spanish', 'french'];
  const bests = (length: number) =>
    Array.from({ length: 40 }, (_, i) => ({
      acc: 90 + (i % 10),
      consistency: 70 + (i % 20),
      difficulty: ['normal', 'expert'][i % 2],
      lazyMode: i % 3 === 0,
      language: languages[i % languages.length],
      punctuation: i % 4 === 1,
      numbers: i % 8 === 2,
      raw: 100 + length / 10 + i,
      wpm: 95 + length / 10 + i,
      timestamp: Date.UTC(2025, 0, 1) + i * 86_400_000,
    }));
  const mode = (lengths: number[]) =>
    JSON.stringify({
      message: 'Personal bests retrieved',
      data: Object.fromEntries(lengths.map((length) => [String(length), bests(length)])),
    });
  const custom = [5, 7, 45, 90, 180, 300];
  return new Map([
    ['monkeytype time', mode([15, 30, 60, 120, ...custom])],
    ['monkeytype words', mode([10, 25, 50, 100, ...custom])],
  ]);
}

/**
 * repo-pulse's activity for the `length` days ending today (ADR 0038), every day recorded and
 * `repos` repositories active on each. A day's counts depend only on its date, so two answers
 * agree on the days they share; `today` adds one push to the last day.
 */
function activityBody(repos: number, length: number, today = 0) {
  const last = Math.floor(Date.now() / 86_400_000);
  const days = Array.from({ length }, (_, i) => {
    const day = last - (length - 1) + i;
    const list = Array.from({ length: repos }, (_, r) => ({
      repo: `ayagmar/repository-${String(r).padStart(2, '0')}`,
      pushes: 2 + (day === last && r === 0 ? today : 0),
      commits: 7,
      merges: 3,
      releases: (day + r) % 9 === 0 ? 1 : 0,
      stars: r % 3,
    }));
    const sum = (key: 'pushes' | 'commits' | 'merges' | 'releases' | 'stars') =>
      list.reduce((total, repo) => total + repo[key], 0);
    return {
      date: new Date(day * 86_400_000).toISOString().slice(0, 10),
      pushes: sum('pushes'),
      commits: sum('commits'),
      merges: sum('merges'),
      releases: sum('releases'),
      stars: sum('stars'),
      repos: list,
      reposTruncated: false,
    };
  });
  return {
    generatedAt: new Date().toISOString(),
    since: new Date((last - 399) * 86_400_000).toISOString().slice(0, 10),
    complete: true,
    days,
  };
}

const activityAnswers = (repos: number, length: number, today = 0): Answers =>
  new Map([['activity', JSON.stringify(activityBody(repos, length, today))]]);

/**
 * What an earlier whole answer stored: the 400 days of `activityBody(repos, 400)`, and a
 * snapshot whose `fullOn` is today when `wholeToday`, so the pull asks for 35 days.
 */
function storedActivity(repos: number, wholeToday: boolean) {
  const body = activityBody(repos, 400);
  const today = body.days.at(-1)?.date ?? '';
  return {
    snapshot: {
      since: body.since,
      repos: body.days[0]?.repos.map(({ repo }) => repo) ?? [],
      fullOn: wholeToday ? today : null,
    },
    days: body.days.map(({ date, ...day }) => ({ day: date, json: JSON.stringify(day) })),
  };
}

/**
 * GitHub's answer for the project logs (ADR 0046) with every node at its longest: for each
 * featured project 10 releases with 60-character tags and 30 merged PRs with 300-character
 * titles, about 240 KB.
 */
function projectEventsMaxAnswer(): string {
  const now = Date.now();
  const at = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
  const data = Object.fromEntries(
    featuredProjects.map(({ slug, repo }) => [
      projectAlias(slug),
      {
        nameWithOwner: repo,
        isPrivate: false,
        releases: {
          nodes: Array.from({ length: 10 }, (_, i) => {
            const tag = `v${i}.`.padEnd(60, '0');
            return {
              tagName: tag,
              url: `https://github.com/${repo}/releases/tag/${tag}`,
              createdAt: at(60 * i + 5),
              publishedAt: at(60 * i),
            };
          }),
        },
        pullRequests: {
          nodes: Array.from({ length: projectMergesAsked }, (_, i) => ({
            number: 1000 - i,
            title: `Change ${i} `.padEnd(300, 'x'),
            url: `https://github.com/${repo}/pull/${1000 - i}`,
            mergedAt: at(30 * i + 1),
            updatedAt: at(30 * i),
            author: { login: i % 5 === 0 ? 'dependabot' : 'ayagmar' },
          })),
        },
      },
    ])
  );
  return JSON.stringify({ data });
}

/** The project logs pull with a token, which the bench's config has none of. */
const projectEventsWithToken: typeof projectEvents = {
  ...projectEvents,
  // An optional secret, so the generated `Env` does not declare it (secrets.ts).
  fetch: (env, signal) => projectEvents.fetch({ ...env, GITHUB_TOKEN: 'bench' } as Env, signal),
};

/** What earlier invocations of a pull saved: `read` of the date's years, each summarized. */
const progress = (years: number, read: number, name = 'Track') => {
  const today = dateAt(Date.now() / 1000);
  const thisYear = Number(today.slice(0, 4));
  return {
    describedDate: today,
    state: {
      firstYear: thisYear - years,
      read,
      years: Array.from({ length: read }, (_, i) => ({
        year: thisYear - 1 - i,
        scrobbles: 200,
        read: 200,
        top: { track: `${name} ${i}`, artist: `${name} artist ${i}`, plays: 7 },
      })),
    },
  };
};

const scenarios: Record<
  string,
  {
    adapter?: PullAdapter;
    answers: () => Answers;
    seed?: () => ReturnType<typeof progress>;
    /** The run must leave a row in `daily`. */
    days?: boolean;
    /** Stores a listening snapshot from this moment before each run, so the pull carries it. */
    carries?: boolean;
    /** Arms one date of the backfill before each run, over stored snapshots. */
    backfill?: boolean;
    /** The activity history and snapshot stored before each run. */
    activity?: () => ReturnType<typeof storedActivity>;
  }
> = {
  // A cron invocation with no adapter due: what every scenario's number is measured against.
  baseline: { answers: () => new Map() },
  // Every part read: a first run, or the rollover into a new week.
  listening: { adapter: listening, answers: listeningAnswers },
  // The usual minute (ADR 0009): the recent tracks read, the rest carried.
  'listening-carried': { adapter: listening, answers: listeningAnswers, carries: true },
  // The pulls that record days (ADR 0038): the hourly one, every weather pull, a backfill's date.
  'listening-days': { adapter: listeningInWindow, answers: listeningDayAnswers, days: true },
  weather: {
    adapter: weather,
    answers: () => new Map([['forecast', JSON.stringify(rawFixtures['open-meteo'].ok.body)]]),
    days: true,
  },
  // Through the scheduler, with the real listening adapter just pulled: the run's turn goes to
  // the backfill and the adapter does not run, so this is one whole backfill turn.
  backfill: { adapter: listening, answers: backfillAnswers, backfill: true, days: true },
  // The real answers (0.7 KiB), and answers near the adapter's body cap.
  monkeytype: {
    adapter: monkeytype,
    answers: () =>
      new Map([
        ['monkeytype time', JSON.stringify(rawFixtures.monkeytype.ok.time.body)],
        ['monkeytype words', JSON.stringify(rawFixtures.monkeytype.ok.words.body)],
      ]),
  },
  'monkeytype-max': { adapter: monkeytype, answers: monkeytypeAnswers },
  // The project logs: the real answer of 2026-11-11 (70 KB), and every node at its longest.
  'project-events': {
    adapter: projectEventsWithToken,
    answers: () => new Map([['graphql', JSON.stringify(rawFixtures['github-graphql'].ok.body)]]),
  },
  'project-events-max': {
    adapter: projectEventsWithToken,
    answers: () => new Map([['graphql', projectEventsMaxAnswer()]]),
  },
  // The first activity pull, every one of its 400 days new: three repositories a day (a busy
  // year for this account), and twelve, near the adapter's 512 KiB body cap.
  activity: { adapter: shippingActivity, answers: () => activityAnswers(3, 400) },
  'activity-max': { adapter: shippingActivity, answers: () => activityAnswers(12, 400) },
  // The first pull of a UTC date: the 400 days, all stored already but today's, which has one
  // more push (ADR 0038).
  'activity-daily': {
    adapter: shippingActivity,
    answers: () => activityAnswers(3, 400, 1),
    activity: () => storedActivity(3, false),
  },
  'activity-daily-max': {
    adapter: shippingActivity,
    answers: () => activityAnswers(12, 400, 1),
    activity: () => storedActivity(12, false),
  },
  // Every other pull: the last 35 days, today's with one more push.
  'activity-hourly': {
    adapter: shippingActivity,
    answers: () => activityAnswers(3, 35, 1),
    activity: () => storedActivity(3, true),
  },
  'activity-hourly-max': {
    adapter: shippingActivity,
    answers: () => activityAnswers(12, 35, 1),
    activity: () => storedActivity(12, true),
  },
  // A pull's first invocation for the account today (three years): registration, then the
  // newest year's page, at 100 scrobbles (the real days had 29 to 99), and progress saved.
  'history-first': { adapter: listeningHistory, answers: () => historyAnswers(3, 100) },
  // A middle invocation: one full page of 200 scrobbles, the most one invocation reads.
  'history-full-page': {
    adapter: listeningHistory,
    answers: () => historyAnswers(3, 200),
    seed: () => progress(3, 1),
  },
  // The last invocation of the longest pull: a full page, then 24 years published, each with
  // titles of 1,024 characters, the largest snapshot the contract allows.
  'history-last-of-24': {
    adapter: listeningHistory,
    answers: () => historyAnswers(24, 200),
    seed: () => progress(24, 23, 'x'.repeat(1000)),
  },
};

let prepared: Answers | undefined;

async function answer(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.host === 'repo-pulse.ayagmar.workers.dev') {
    const body = prepared?.get('activity');
    return body === undefined ? new Response('{}', { status: 404 }) : new Response(body);
  }
  if (url.host === 'api.open-meteo.com' || url.host === 'archive-api.open-meteo.com') {
    const body = prepared?.get(url.host === 'api.open-meteo.com' ? 'forecast' : 'archive');
    return body === undefined ? new Response('{}', { status: 404 }) : new Response(body);
  }
  if (url.host === 'api.github.com') {
    const body = prepared?.get('graphql');
    return body === undefined ? new Response('{}', { status: 404 }) : new Response(body);
  }
  if (url.host === 'api.monkeytype.com') {
    const body = prepared?.get(`monkeytype ${url.searchParams.get('mode')}`);
    return body === undefined ? new Response('{}', { status: 404 }) : new Response(body);
  }
  const form = new URLSearchParams(await request.text());
  const method = form.get('method') ?? '';
  const span = Number(form.get('to')) - Number(form.get('from'));
  const key = form.has('page')
    ? `${method} ${form.get('from')} ${form.get('to')} ${form.get('page')}`
    : form.has('to') && span <= 25 * 3600
      ? `day ${form.get('from')}`
      : form.has('from')
        ? `${method} week`
        : method;
  const body = prepared?.get(key);
  return body === undefined ? new Response('{}', { status: 404 }) : new Response(body);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const scenario = scenarios[url.searchParams.get('scenario') ?? ''];
    if (scenario === undefined) return new Response('unknown scenario', { status: 404 });
    if (url.pathname === '/prepare') {
      prepared = scenario.answers();
      globalThis.fetch = async (input, init) => answer(new Request(input, init));
      return new Response('prepared');
    }
    if (url.pathname === '/setup') {
      // Forget the last attempt so the adapter is due, and set up the pull's progress.
      const activity = scenario.activity?.();
      await env.DB.batch([
        env.DB.prepare('DELETE FROM snapshots'),
        env.DB.prepare('DELETE FROM pull_progress'),
        env.DB.prepare('DELETE FROM daily'),
        ...(activity === undefined
          ? []
          : [
              env.DB.prepare(
                "INSERT INTO snapshots (source, json, fetched_at) VALUES ('shipping-activity', ?, '2000-01-01T00:00:00.000Z')"
              ).bind(JSON.stringify(activity.snapshot)),
              env.DB.prepare(
                `INSERT INTO daily (source, day, json, fetched_at, updated_at)
                 SELECT 'shipping-activity', json_extract(value, '$.day'), json_extract(value, '$.json'), '2000-01-01T00:00:00.000Z', '2000-01-01T00:00:00.000Z'
                 FROM json_each(?)`
              ).bind(JSON.stringify(activity.days)),
            ]),
      ]);
      if (scenario.carries === true) {
        await env.DB.prepare(
          "INSERT INTO snapshots (source, json, fetched_at) VALUES ('listening', ?, ?)"
        )
          .bind(JSON.stringify(snapshotFixtures.listening.ok), new Date().toISOString())
          .run();
      }
      if (scenario.backfill === true) {
        await env.DB.batch([
          env.DB.prepare(
            `INSERT INTO snapshots (source, json, fetched_at)
             VALUES ('listening', '{}', '2000-01-01T00:00:00.000Z'), ('weather', '{}', '2000-01-01T00:00:00.000Z')`
          ),
          env.DB.prepare(
            "UPDATE snapshots SET last_attempt_at = ? WHERE source = 'listening'"
          ).bind(Date.now() - 60_000),
          env.DB.prepare(
            `INSERT INTO pull_progress (source, described_date, step, json)
             VALUES ('daily-backfill', ?1, 1, json_object('next', ?1, 'to', ?1, 'tries', 0))`
          ).bind(backfillDate),
        ]);
      }
      const seed = scenario.seed?.();
      if (seed !== undefined) {
        await env.DB.prepare(
          "INSERT INTO pull_progress (source, described_date, step, json) VALUES ('listening-history', ?, 1, ?)"
        )
          .bind(seed.describedDate, JSON.stringify(seed.state))
          .run();
      }
      return new Response('set up');
    }
    // One cron invocation: what the bench measures.
    await runScheduled(env, scenario.adapter ? [scenario.adapter] : [], Date.now());
    const row = await env.DB.prepare(
      'SELECT last_error_code, length(json) AS bytes FROM snapshots'
    ).first<{ last_error_code: string | null; bytes: number | null }>();
    // A day read that fails is only logged, and would measure as cheap.
    const days = await env.DB.prepare('SELECT count(*) AS n FROM daily').first<{ n: number }>();
    // Run outside a date's first 15 minutes in Rabat, when a backfill takes no turn.
    if (scenario.days === true && days?.n === 0) {
      return Response.json({ ...row, last_error_code: 'no_day_recorded' });
    }
    // A step that saved its part reports `in_progress`: for the bench, a success.
    return Response.json(
      row?.last_error_code === 'in_progress' ? { ...row, last_error_code: null } : row
    );
  },
} satisfies ExportedHandler<Env>;
