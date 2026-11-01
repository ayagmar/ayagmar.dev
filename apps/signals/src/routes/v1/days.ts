import {
  type DailySource,
  dailySources,
  dailyZones,
  daysLast,
  featuredProjects,
  githubOwner,
  isDailySource,
  type ShippingActivityDay,
  type ShippingActivitySnapshot,
  type ShippingActivityStoredDay,
} from '@min7/contracts';
import { rabatDate } from '@min7/contracts/rabat';
import { type Context, Hono } from 'hono';
import type { AppEnv } from '../../env.ts';
import { methodNotAllowed, notFound } from '../../errors.ts';
import { preflight } from '../../security/cors.ts';
import { D1SnapshotStore } from '../../storage/d1.ts';
import { readDays } from '../../storage/daily.ts';
import { serveEnvelope } from './snapshot.ts';

/** The earliest month served: llm-usage's first push reaches 53 weeks back from late 2026. */
const firstMonth = '2025-01';
/** The path of every series; any other answers the JSON 404. */
const seriesPath = `/:series{${dailySources.join('|')}}`;
const dayMs = 24 * 60 * 60 * 1000;

const utcDate = (time: number) => new Date(time).toISOString().slice(0, 10);

/** Today in the series' zone. */
const today = (series: DailySource, now: number) =>
  dailyZones[series] === 'UTC' ? utcDate(now) : rabatDate(now);

/**
 * The block a query names, or null: exactly one of `?month=YYYY-MM` (a calendar month from
 * 2025-01 to the current one in the series' zone) or `?last=28` (the 28 days ending today
 * there). Only these blocks exist, so every answer is one of a few cache entries and no query
 * can make D1 read more than a month of rows (ADR 0038).
 */
function block(series: DailySource, query: URLSearchParams, now: number) {
  const month = query.get('month');
  const last = query.get('last');
  if ((month === null) === (last === null)) return null;
  if (last !== null) {
    if (last !== String(daysLast)) return null;
    const to = today(series, now);
    const from = utcDate(Date.parse(`${to}T00:00:00Z`) - (daysLast - 1) * dayMs);
    return { key: `last=${daysLast}`, from, to };
  }
  if (month === null || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
  if (month < firstMonth || month > today(series, now).slice(0, 7)) return null;
  const [year = 0, index = 0] = month.split('-').map(Number);
  const to = utcDate(Date.UTC(year, index, 0));
  return { key: `month=${month}`, from: `${month}-01`, to };
}

/**
 * A stored shipping day as served. A repository is named only if it is the owner's and is in
 * the latest activity answer (repo-pulse names public repositories only) or is featured: a
 * repository made private later stops being named everywhere, its counts stay in the day.
 */
function shippingDay(date: string, stored: ShippingActivityStoredDay, named: ReadonlySet<string>) {
  const repos = stored.repos.filter(
    ({ repo }) => repo.startsWith(`${githubOwner}/`) && named.has(repo)
  );
  const { reposTruncated, ...counts } = stored;
  return {
    date,
    ...counts,
    repos,
    reposComplete: !reposTruncated && repos.length === stored.repos.length,
  } satisfies ShippingActivityDay;
}

async function serveDays(c: Context<AppEnv>, series: DailySource): Promise<Response> {
  const range = block(series, new URL(c.req.url).searchParams, Date.now());
  if (range === null) {
    return c.json({ error: 'invalid_query' }, 400, { 'Cache-Control': 'no-store' });
  }
  return serveEnvelope(c, series, `/v1/days/${series}?${range.key}`, async () => {
    const stored = await new D1SnapshotStore(c.env.DB).get(series);
    if (stored?.snapshot == null) return { fetchedAt: null, data: null };
    const rows = await readDays(c.env.DB, series, range.from, range.to);
    // Rows were checked against the series' schema before they were stored.
    const named = new Set<string>([
      ...(series === 'shipping-activity'
        ? (stored.snapshot as ShippingActivitySnapshot).repos
        : []),
      ...featuredProjects.map((project) => project.repo),
    ]);
    const days = rows.map(({ day, data }) =>
      series === 'shipping-activity'
        ? shippingDay(day, data as ShippingActivityStoredDay, named)
        : { date: day, ...(data as object) }
    );
    return {
      fetchedAt: stored.fetchedAt,
      data: { zone: dailyZones[series], from: range.from, to: range.to, days },
    };
  });
}

/** `GET /v1/days/<series>?month=YYYY-MM` or `?last=28`: a block of daily history (ADR 0038). */
export const days = new Hono<AppEnv>()
  .get(seriesPath, (c) => {
    const name = c.req.param('series') ?? '';
    return isDailySource(name) ? serveDays(c, name) : notFound(c);
  })
  .options(seriesPath, (c) => preflight(c.req.header('origin')))
  .all(seriesPath, methodNotAllowed('GET, HEAD, OPTIONS'));
