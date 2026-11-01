// The IndexNow key file, `/<key>.txt` holding only the key: proof that pings from
// scripts/indexnow.ts come from the site (docs/seo.md).
import type { APIRoute, GetStaticPaths } from 'astro';
import { indexNowKey } from '../lib/search.ts';

export const getStaticPaths = (() => [
  { params: { indexnow: indexNowKey } },
]) satisfies GetStaticPaths;

export const GET: APIRoute = () =>
  new Response(indexNowKey, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
