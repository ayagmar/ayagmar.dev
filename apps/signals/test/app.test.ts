import { exports } from 'cloudflare:workers';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { onError } from '../src/errors.ts';

const get = (path: string) => exports.default.fetch(new Request(`https://api.ayagmar.dev${path}`));

describe('signals', () => {
  it('reports the deployed commit on /v1/health', async () => {
    const response = await get('/v1/health');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/^application\/json/);
    expect(await response.json()).toEqual({ version: 'test-sha', sources: [] });
  });

  it('answers unknown routes with a bare JSON 404', async () => {
    const response = await get('/v1/../internal/debug?x=<script>');
    const body = await response.text();

    expect(response.status).toBe(404);
    expect(JSON.parse(body)).toEqual({ error: 'not_found' });
    expect(body).not.toMatch(/at \w+ \(|\.ts:\d+|stack/i);
  });
});

describe('error handling', () => {
  it('hides thrown errors behind a generic 500 and logs them', async () => {
    const app = new Hono().onError(onError).get('/v1/__throws', () => {
      throw new Error('upstream said: token=abc123');
    });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await app.request('/v1/__throws');
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(JSON.parse(body)).toEqual({ error: 'internal_error' });
    expect(body).not.toContain('abc123');
    expect(logged).toHaveBeenCalledOnce();
  });
});
