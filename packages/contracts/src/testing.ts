// MSW handlers built from the shared fixtures, for tests only: imported from
// `@min7/contracts/testing`, never from the package root, so no production bundle pulls in msw.
import { HttpResponse, http } from 'msw';
import type { Envelope } from './envelope.ts';
import { rawFixtures, snapshotFixtures } from './fixtures.ts';

/** One recorded upstream response; null stands for a network failure. */
type Recorded = { status: number; body: unknown } | null;

const reply = (recorded: Recorded | undefined) => {
  if (recorded === undefined) return HttpResponse.json({ message: 'Not Found' }, { status: 404 });
  if (recorded === null) return HttpResponse.error();
  if (recorded.body === null) return new HttpResponse(null, { status: recorded.status });
  return HttpResponse.json(recorded.body, { status: recorded.status });
};

type Cases<Source extends keyof typeof rawFixtures> = keyof (typeof rawFixtures)[Source];

export interface UpstreamCases {
  lastfm?: Cases<'lastfm'>;
  lastfmHistory?: Cases<'lastfm-history'>;
  github?: Cases<'github'>;
  npm?: Cases<'npm'>;
  repoPulse?: Cases<'repo-pulse'>;
  repoPulseActivity?: Cases<'repo-pulse-activity'>;
  openMeteo?: Cases<'open-meteo'>;
  monkeytype?: Cases<'monkeytype'>;
}

/**
 * Handlers that answer the upstream APIs the signals pull adapters call, one fixture case
 * per upstream (`ok` unless given). A request to any other host stays unhandled.
 */
export function upstreamHandlers(cases: UpstreamCases = {}) {
  const lastfm: Record<string, Recorded> = rawFixtures.lastfm[cases.lastfm ?? 'ok'];
  const history: {
    registration: Recorded;
    days: { from: number; to: number; page: Recorded }[];
  } = rawFixtures['lastfm-history'][cases.lastfmHistory ?? 'ok'];
  // Each history request is answered once: a repeated one is a bug in the pull.
  const asked = new Set<string>();
  const github: Record<string, { repo: Recorded; release: Recorded }> =
    rawFixtures.github[cases.github ?? 'ok'];
  const npm: Record<string, Recorded> = rawFixtures.npm[cases.npm ?? 'ok'];
  const repoPulse: Recorded = rawFixtures['repo-pulse'][cases.repoPulse ?? 'ok'];
  const activity: Recorded = rawFixtures['repo-pulse-activity'][cases.repoPulseActivity ?? 'ok'];
  const openMeteo: Recorded = rawFixtures['open-meteo'][cases.openMeteo ?? 'ok'];
  const monkeytype: Record<string, Recorded> = rawFixtures.monkeytype[cases.monkeytype ?? 'ok'];

  return [
    // signals POSTs its Last.fm parameters as a form, to keep the API key out of URLs.
    http.post('https://ws.audioscrobbler.com/2.0/', async ({ request }) => {
      const query = await request.formData();
      const method = query.get('method');
      // Listening history (ADR 0030): `user.getinfo`, and recent tracks by page. Answered only
      // for min7_, a key and JSON, the exact day ranges of the case and page 1 of 200, once.
      if (method === 'user.getinfo' || query.has('page')) {
        const key = [...query.entries()].filter(([name]) => name !== 'api_key').join('&');
        const valid =
          query.get('user') === 'min7_' &&
          query.get('format') === 'json' &&
          (query.get('api_key') ?? '') !== '' &&
          !asked.has(key);
        asked.add(key);
        if (!valid) return HttpResponse.error();
        if (method === 'user.getinfo') return reply(history.registration);
        const day = history.days.find(
          (d) => String(d.from) === query.get('from') && String(d.to) === query.get('to')
        );
        const exact =
          method === 'user.getrecenttracks' &&
          query.get('limit') === '200' &&
          query.get('page') === '1';
        return day !== undefined && exact ? reply(day.page) : HttpResponse.error();
      }
      if (method === 'user.gettopartists') return reply(lastfm.topArtists);
      if (query.has('to')) return reply(lastfm.lastWeek);
      if (query.has('from')) return reply(lastfm.thisWeek);
      return reply(lastfm.recentTracks);
    }),
    http.get('https://api.github.com/repos/:owner/:repo/releases/latest', ({ params }) =>
      reply(github[`${params.owner}/${params.repo}`]?.release)
    ),
    http.get('https://api.github.com/repos/:owner/:repo', ({ params }) =>
      reply(github[`${params.owner}/${params.repo}`]?.repo)
    ),
    http.get('https://api.npmjs.org/downloads/point/last-month/*', ({ request }) => {
      const prefix = '/downloads/point/last-month/';
      return reply(npm[decodeURIComponent(new URL(request.url).pathname.slice(prefix.length))]);
    }),
    http.get('https://repo-pulse.ayagmar.workers.dev/public/feed', () => reply(repoPulse)),
    // Daily activity (ADR 0038): answered only for exactly `?days=400`, or `?days=35` with the
    // case's last 35 days.
    http.get('https://repo-pulse.ayagmar.workers.dev/public/activity', ({ request }) => {
      const query = new URL(request.url).searchParams;
      const days = query.size === 1 ? query.get('days') : null;
      if (days === '400') return reply(activity);
      if (days !== '35') return HttpResponse.error();
      const body = activity?.body as { days?: unknown } | null | undefined;
      return Array.isArray(body?.days)
        ? reply({ status: activity?.status ?? 200, body: { ...body, days: body.days.slice(-35) } })
        : reply(activity);
    }),
    http.get('https://api.open-meteo.com/v1/forecast', () => reply(openMeteo)),
    // Monkeytype (ADR 0033): answered only with an ApeKey and for exactly `?mode=time` or
    // `?mode=words`; the answer the case has none for (not asked) fails.
    http.get('https://api.monkeytype.com/users/personalBests', ({ request }) => {
      const query = new URL(request.url).searchParams;
      const mode = query.get('mode') ?? '';
      const valid =
        /^ApeKey \S+$/.test(request.headers.get('authorization') ?? '') &&
        query.size === 1 &&
        (mode === 'time' || mode === 'words');
      return valid ? reply(monkeytype[mode]) : HttpResponse.error();
    }),
  ];
}

type PullSource = keyof typeof snapshotFixtures;

/** The `ok` snapshot of a pull source wrapped in a read API envelope fetched at `fetchedAt`. */
export function fixtureEnvelope<Source extends PullSource>(
  source: Source,
  fetchedAt: string
): Envelope<(typeof snapshotFixtures)[Source]['ok'], Source> {
  return { source, version: 1, fetchedAt, stale: false, data: snapshotFixtures[source].ok };
}
