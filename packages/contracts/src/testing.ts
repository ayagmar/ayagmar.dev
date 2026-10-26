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
  github?: Cases<'github'>;
  npm?: Cases<'npm'>;
  repoPulse?: Cases<'repo-pulse'>;
}

/**
 * Handlers that answer the upstream APIs the signals pull adapters call, one fixture case
 * per upstream (`ok` unless given). A request to any other host stays unhandled.
 */
export function upstreamHandlers(cases: UpstreamCases = {}) {
  const lastfm: Record<string, Recorded> = rawFixtures.lastfm[cases.lastfm ?? 'ok'];
  const github: Record<string, { repo: Recorded; release: Recorded }> =
    rawFixtures.github[cases.github ?? 'ok'];
  const npm: Record<string, Recorded> = rawFixtures.npm[cases.npm ?? 'ok'];
  const repoPulse: Recorded = rawFixtures['repo-pulse'][cases.repoPulse ?? 'ok'];

  return [
    // signals POSTs its Last.fm parameters as a form, to keep the API key out of URLs.
    http.post('https://ws.audioscrobbler.com/2.0/', async ({ request }) => {
      const query = await request.formData();
      if (query.get('method') === 'user.gettopartists') return reply(lastfm.topArtists);
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
