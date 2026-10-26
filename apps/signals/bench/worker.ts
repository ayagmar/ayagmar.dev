// The CPU bench Worker (`just signals-cpu`, ADR 0030): runs one real cron invocation of a
// pull adapter, D1 included, with Last.fm answered from memory, so the CPU it takes is
// signals' own work. Never deployed; scripts/signals-cpu.ts drives it.
import { rawFixtures } from '@min7/contracts/fixtures';
import { listening } from '../src/adapters/pull/listening.ts';
import { listeningHistory } from '../src/adapters/pull/listening-history.ts';
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
  { adapter?: PullAdapter; answers: () => Answers; seed?: () => ReturnType<typeof progress> }
> = {
  // A cron invocation with no adapter due: what every scenario's number is measured against.
  baseline: { answers: () => new Map() },
  listening: { adapter: listening, answers: listeningAnswers },
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
  const form = new URLSearchParams(await request.text());
  const method = form.get('method') ?? '';
  const key = form.has('page')
    ? `${method} ${form.get('from')} ${form.get('to')} ${form.get('page')}`
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
      await env.DB.batch([
        env.DB.prepare('DELETE FROM snapshots'),
        env.DB.prepare('DELETE FROM pull_progress'),
      ]);
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
    // A step that saved its part reports `in_progress`: for the bench, a success.
    return Response.json(
      row?.last_error_code === 'in_progress' ? { ...row, last_error_code: null } : row
    );
  },
} satisfies ExportedHandler<Env>;
