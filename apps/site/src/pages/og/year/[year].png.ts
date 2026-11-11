// A year page's link-preview image: the year, its shipping calendar and its figures (ADR 0041).
import type { APIRoute, GetStaticPaths } from 'astro';
import { renderYearCard } from '../../../lib/og-card.ts';
import { getDays } from '../../../lib/posts.ts';

export const getStaticPaths = (async () =>
  (await getDays()).years.map((page) => ({
    params: { year: page.year },
    props: { page },
  }))) satisfies GetStaticPaths;

export const GET: APIRoute<Awaited<ReturnType<typeof getStaticPaths>>[number]['props']> = async ({
  props: { page },
}) =>
  new Response(new Uint8Array(await renderYearCard(page)), {
    headers: { 'Content-Type': 'image/png' },
  });
