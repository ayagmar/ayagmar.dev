// Fixtures builds answer the room's scrub from their own origin (ADR 0044), so a Preview scrubs
// through sample days and makes no request to signals. An `api` build has no such paths.
import { dailySources } from '@min7/contracts';
import type { APIRoute, GetStaticPaths } from 'astro';
import { historyMonths, type SiteSeries } from '../../../../data/reader.ts';
import { signals, signalsMode } from '../../../../data/signals.ts';

export const getStaticPaths = (() =>
  signalsMode !== 'fixtures'
    ? []
    : dailySources.flatMap((series) =>
        historyMonths(series, new Date()).map((month) => ({ params: { series, month } }))
      )) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ params }) =>
  Response.json(await signals.readMonth(params.series as SiteSeries, params.month as string));
