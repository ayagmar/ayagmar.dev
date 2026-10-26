// Adapter `fetch` inside workerd, with the network mocked by @msw/cloudflare from the shared
// fixtures. A request no handler answers fails instead of reaching the internet.

import { env } from 'cloudflare:workers';
import { rawFixtures } from '@min7/contracts/fixtures';
import { upstreamHandlers } from '@min7/contracts/testing';
import { setupNetwork } from '@msw/cloudflare';
import { delay, HttpResponse, http } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PullError } from '../src/adapters/pull/index.ts';
import { listening } from '../src/adapters/pull/listening.ts';
import { projects } from '../src/adapters/pull/projects.ts';
import { shipping } from '../src/adapters/pull/shipping.ts';

const network = setupNetwork();
network.configure({ onUnhandledFrame: 'error' });
beforeAll(() => network.enable());
afterEach(() => network.resetHandlers());
afterAll(() => network.disable());

// Obviously fake secrets.
const lastfmKey = 'fake-lastfm-key';
const githubToken = 'fake-github-token';
const withSecrets = { ...env, LASTFM_API_KEY: lastfmKey, GITHUB_TOKEN: githubToken };
const signal = () => AbortSignal.timeout(2_000);
const feed = 'https://repo-pulse.ayagmar.workers.dev/public/feed';

async function pullError(promise: Promise<unknown>): Promise<PullError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason
  );
  expect(error).toBeInstanceOf(PullError);
  return error as PullError;
}

describe('network mocking', () => {
  it('fails a request to a host no handler answers', async () => {
    await expect(fetch('https://example.com/')).rejects.toThrow();
    expect((await pullError(shipping.fetch(env, signal()))).code).toBe('upstream_unreachable');
  });
});

describe('pull adapter fetch', () => {
  it('returns what each upstream answered, as the raw fixtures record it', async () => {
    network.use(...upstreamHandlers());

    expect(await listening.fetch(withSecrets, signal())).toEqual(rawFixtures.lastfm.ok);
    expect(await shipping.fetch(env, signal())).toEqual(rawFixtures['repo-pulse'].ok);
    expect(await projects.fetch(withSecrets, signal())).toEqual({
      github: rawFixtures.github.ok,
      npm: rawFixtures.npm.ok,
    });
  });

  it('turns a failed part into null and keeps the rest', async () => {
    network.use(...upstreamHandlers({ lastfm: 'partial', github: 'partial', npm: 'partial' }));

    expect(await listening.fetch(withSecrets, signal())).toEqual(rawFixtures.lastfm.partial);
    expect(await projects.fetch(withSecrets, signal())).toEqual({
      github: rawFixtures.github.partial,
      npm: rawFixtures.npm.partial,
    });
  });

  it('sends the GitHub token to api.github.com only, and the Last.fm key to Last.fm only', async () => {
    const seen: { host: string; authorization: string | null; url: string; body: string }[] = [];
    network.use(
      http.all('*', async ({ request }) => {
        seen.push({
          host: new URL(request.url).host,
          authorization: request.headers.get('authorization'),
          url: request.url,
          body:
            request.method === 'POST'
              ? [...(await request.clone().formData()).values()].join('&')
              : '',
        });
      }),
      ...upstreamHandlers()
    );

    await listening.fetch(withSecrets, signal());
    await shipping.fetch(withSecrets, signal());
    await projects.fetch(withSecrets, signal());

    for (const request of seen) {
      const isGithub = request.host === 'api.github.com';
      expect(request.authorization, request.host).toBe(isGithub ? `Bearer ${githubToken}` : null);
      // Workers traces record request URLs, so no secret may be in one.
      expect(request.url, request.host).not.toContain(lastfmKey);
      expect(request.body.includes(lastfmKey), request.host).toBe(
        request.host === 'ws.audioscrobbler.com'
      );
    }
    expect(new Set(seen.map((request) => request.host))).toEqual(
      new Set([
        'ws.audioscrobbler.com',
        'repo-pulse.ayagmar.workers.dev',
        'api.github.com',
        'api.npmjs.org',
      ])
    );
  });

  it('calls GitHub without a token when none is set', async () => {
    const authorizations: (string | null)[] = [];
    network.use(
      http.get('https://api.github.com/*', ({ request }) => {
        authorizations.push(request.headers.get('authorization'));
      }),
      ...upstreamHandlers()
    );

    await projects.fetch(env, signal());
    expect(authorizations.length).toBeGreaterThan(0);
    expect(authorizations.every((value) => value === null)).toBe(true);
  });

  it('refuses to call Last.fm without an API key', async () => {
    expect((await pullError(listening.fetch(env, signal()))).code).toBe('not_configured');
  });

  it('stops reading a body over the size limit, with or without Content-Length', async () => {
    const big = JSON.stringify({ padding: 'x'.repeat(300 * 1024) });
    network.use(
      http.get(
        feed,
        () => new HttpResponse(big, { headers: { 'content-length': `${big.length}` } })
      )
    );
    expect((await pullError(shipping.fetch(env, signal()))).code).toBe('upstream_too_large');

    const encoder = new TextEncoder();
    network.use(
      http.get(
        feed,
        () =>
          new HttpResponse(
            new ReadableStream({
              start(controller) {
                for (let i = 0; i < 40; i++)
                  controller.enqueue(encoder.encode('x'.repeat(8 * 1024)));
                controller.close();
              },
            })
          )
      )
    );
    expect((await pullError(shipping.fetch(env, signal()))).code).toBe('upstream_too_large');
  });

  it('gives up when the upstream does not answer in time', async () => {
    network.use(
      http.get(feed, async () => {
        await delay('infinite');
      })
    );
    const error = await pullError(shipping.fetch(env, AbortSignal.timeout(50)));
    expect(error.code).toBe('upstream_timeout');
  });

  it('keeps upstream text out of the error', async () => {
    network.use(
      http.get(feed, () =>
        HttpResponse.json({ error: `token ${githubToken} rejected` }, { status: 500 })
      )
    );
    const raw = await shipping.fetch(withSecrets, signal());
    let thrown: unknown;
    try {
      shipping.normalize(raw);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(PullError);
    expect(JSON.stringify(thrown)).not.toContain(githubToken);
    expect(String(thrown)).toBe('PullError: upstream_http_error');
    expect((thrown as Error).cause).toBeUndefined();
  });
});
