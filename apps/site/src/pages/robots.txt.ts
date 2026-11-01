// The site's own robots.txt. On ayagmar.dev, Cloudflare's managed robots.txt puts its content
// signals block above this one (docs/seo.md); this part lets every crawler in and names the sitemap.
import type { APIRoute } from 'astro';
import { sitemapUrl } from '../lib/search.ts';

export const GET: APIRoute = () =>
  new Response(`User-agent: *\nAllow: /\n\nSitemap: ${sitemapUrl}\n`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
