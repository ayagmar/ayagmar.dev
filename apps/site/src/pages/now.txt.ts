import { getEntry } from 'astro:content';
import type { APIRoute } from 'astro';
import { renderNowText } from '../lib/now.ts';

// The same entry now.astro renders (ADR 0035); terminal clients get this at /now.
export const GET: APIRoute = async () => {
  const entry = await getEntry('now', 'now');
  if (entry === undefined) throw new Error('content/now.md is missing');
  return new Response(renderNowText(entry.data, entry.body ?? ''), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
