// Which dates have a page, for the room's scrub to link (ADR 0044): a date's page is built only
// from what this build held, so the browser cannot work it out from the records it reads.
import type { APIRoute } from 'astro';
import { getDays } from '../../lib/posts.ts';

export const GET: APIRoute = async () =>
  Response.json({ dates: (await getDays()).pages.map((page) => page.date) });
