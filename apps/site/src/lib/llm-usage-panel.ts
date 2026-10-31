/**
 * The LLM usage panel on /stats (ADR 0014): its words, numbers and markup, drawn by the build
 * and again by the browser for each newer answer (src/scripts/stats-live.ts).
 */
import type { LlmUsageSnapshot } from '@min7/contracts';
import { rabatDate } from '@min7/contracts/rabat';
import { el, type Markup } from './markup.ts';

const hourMs = 3_600_000;
const dayMs = 86_400_000;

/** `283 hours`, `7.5 hours`, `0 hours`: whole hours from 10 up, one decimal below. */
export function hours(ms: number): string {
  const value = ms / hourMs;
  const shown = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${shown.toLocaleString('en')} ${shown === 1 ? 'hour' : 'hours'}`;
}

const units: [size: number, unit: string][] = [
  [1e12, 'T'],
  [1e9, 'B'],
  [1e6, 'M'],
  [1e3, 'K'],
];
const oneDecimal = { minimumFractionDigits: 1, maximumFractionDigits: 1 };

/** `41.0B`, `1.8B`, `61.3M`, `950.0K`, `999`: one decimal from a thousand up. */
export function tokens(count: number): string {
  const at = units.findIndex(([size]) => count >= size);
  if (at === -1) return count.toLocaleString('en');
  const shown = (index: number) => {
    const [size, unit] = units[index] as [number, string];
    return { value: Math.round((count / size) * 10) / 10, unit };
  };
  let { value, unit } = shown(at);
  // 999,960 is 1,000.0K at one decimal: the next unit up says it better.
  if (value >= 1000 && at > 0) ({ value, unit } = shown(at - 1));
  return `${value.toLocaleString('en', oneDecimal)}${unit}`;
}

/**
 * An agent's share of the month's tokens: whole percents, `<1%` for a sliver, and never 100%
 * while another agent has any. signals rounds shares to 4 decimals, so an agent with a few
 * tokens can arrive with a share of 0: its tokens say it is a sliver, not nothing.
 */
export function share(fraction: number, count: number): string {
  if (count > 0 && fraction < 0.01) return '<1%';
  const percent = Math.round(fraction * 100);
  return `${fraction < 1 ? Math.min(percent, 99) : percent}%`;
}

const utcDate = (date: string) => Date.parse(`${date}T00:00:00Z`);
const isoDate = (time: number) => new Date(time).toISOString().slice(0, 10);
const dayMonth = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'short',
});
const fullDate = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** `1–26 Oct`, `28 Sept–4 Oct`, or `1 Oct` for a single day. */
export function dateRange(from: string, to: string): string {
  if (from === to) return dayMonth.format(utcDate(to));
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  const start = sameMonth ? String(Number(from.slice(8))) : dayMonth.format(utcDate(from));
  return `${start}–${dayMonth.format(utcDate(to))}`;
}

/**
 * The year heatmap: a cell per day for the 53 weeks ending on `end`, a column per week from
 * Monday, and a level from 0 (no tokens or no bucket) to 4. The levels are the quartiles of
 * the days with tokens, so one huge day does not wash out the rest.
 */
export function heatmap(days: LlmUsageSnapshot['days'], end: string, weeks = 53) {
  const last = utcDate(end);
  const weekday = (new Date(last).getUTCDay() + 6) % 7;
  const first = last - ((weeks - 1) * 7 + weekday) * dayMs;
  const byDate = new Map(days.map((day) => [day.date, day.totalTokens]));
  const cells = [];
  for (let time = first; time <= last; time += dayMs) {
    const date = isoDate(time);
    cells.push({ date, tokens: byDate.get(date) });
  }
  const used = cells.flatMap(({ tokens: count }) => (count ? [count] : [])).sort((a, b) => a - b);
  const quartiles = [0.25, 0.5, 0.75].map((q) => used[Math.floor(q * (used.length - 1))] as number);
  const busiest = cells.reduce<(typeof cells)[number] | undefined>(
    (top, cell) => ((cell.tokens ?? 0) > (top?.tokens ?? 0) ? cell : top),
    undefined
  );
  return {
    from: isoDate(first),
    to: end,
    activeDays: used.length,
    busiest,
    cells: cells.map((cell) => ({
      ...cell,
      level: cell.tokens ? 1 + quartiles.filter((q) => (cell.tokens as number) > q).length : 0,
    })),
  };
}

const plural = (count: number, one: string, many: string) =>
  `${count.toLocaleString('en')} ${count === 1 ? one : many}`;

/**
 * The panel's body for a snapshot taken at `fetchedAt`. The month, the last 7 days, the agents
 * and the current streak describe the date in Rabat the snapshot was taken, named in their
 * labels and carried in `data-rabat-date` so the page script can hide them once that date has
 * passed (src/scripts/stats-live.ts). The longest streak and the daily heatmap hold for good, so
 * they sit outside that block.
 */
export function llmUsagePanel(data: LlmUsageSnapshot, fetchedAt: string): Markup[] {
  // Costs (`costUsd`, `cacheSavingsUsd`) are in the snapshot and checked, but not shown: the
  // owner has not decided to publish them.
  const { monthToDate: month, last7Days: week, streak, days } = data;
  const date = rabatDate(Date.parse(fetchedAt));
  const monthRange = dateRange(`${date.slice(0, 8)}01`, date);
  const weekRange = dateRange(isoDate(utcDate(date) - 6 * dayMs), date);
  const sentHours = month.activeMs !== undefined || week.activeMs !== undefined;
  const hoursCell = (ms: number | undefined) =>
    el('td', {}, ms === undefined ? 'unknown' : hours(ms));
  const heading = (label: string, range: string) =>
    el('th', { scope: 'col' }, label, ' ', el('span', { class: 'llm-range' }, range));

  const period = el(
    'div',
    { class: 'llm-period', 'data-rabat-date': date },
    el(
      'table',
      { class: 'llm-totals' },
      el('caption', { class: 'sr-only' }, 'Tokens and estimated agent hours'),
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          el('td', {}),
          heading('This month', monthRange),
          heading('Last 7 days', weekRange)
        )
      ),
      el(
        'tbody',
        {},
        el(
          'tr',
          {},
          el('th', { scope: 'row' }, 'Tokens'),
          el('td', {}, tokens(month.totalTokens)),
          el('td', {}, tokens(week.totalTokens))
        ),
        ...(sentHours
          ? [
              el(
                'tr',
                {},
                el('th', { scope: 'row' }, 'Agent hours'),
                hoursCell(month.activeMs),
                hoursCell(week.activeMs)
              ),
            ]
          : [])
      )
    ),
    el(
      'p',
      { class: 'llm-streak' },
      `Streak on ${dayMonth.format(utcDate(date))}: ${plural(streak.currentDays, 'day', 'days')}.`
    ),
    el('h3', {}, 'Agents this month'),
    month.agents.length === 0
      ? el('p', {}, 'No agent use this month yet.')
      : el(
          'ol',
          { class: 'llm-agents' },
          ...month.agents.map(({ agent, totalTokens, tokenShare }) =>
            el(
              'li',
              {},
              el('span', { class: 'llm-agent' }, agent),
              el(
                'svg',
                {
                  class: 'llm-bar',
                  viewBox: '0 0 100 1',
                  preserveAspectRatio: 'none',
                  'aria-hidden': 'true',
                },
                el('rect', { width: String(Math.round(tokenShare * 1000) / 10), height: '1' })
              ),
              el('span', { class: 'llm-tokens' }, tokens(totalTokens)),
              el('span', { class: 'llm-share' }, share(tokenShare, totalTokens))
            )
          )
        ),
    ...(sentHours
      ? [
          el(
            'p',
            { class: 'llm-note' },
            'Agent hours are estimated from logged agent events with gaps capped at 5 minutes; overlapping sessions and machines count once. They include overnight agents and laptop usage, not my hours at the keyboard.'
          ),
        ]
      : [])
  );

  const longest = el(
    'p',
    { class: 'llm-streak' },
    `Longest streak: ${plural(streak.longestDays, 'day', 'days')}.`
  );
  if (days.length === 0) return [period, longest];
  const heat = heatmap(days, date);
  const summary =
    heat.activeDays === 0 || !heat.busiest?.tokens
      ? `Tokens per day from ${fullDate.format(utcDate(heat.from))} to ${fullDate.format(utcDate(heat.to))}: none.`
      : `Tokens per day from ${fullDate.format(utcDate(heat.from))} to ${fullDate.format(utcDate(heat.to))}: ${plural(heat.activeDays, 'day', 'days')} with use, the busiest ${fullDate.format(utcDate(heat.busiest.date))} with ${tokens(heat.busiest.tokens)}.`;
  return [
    period,
    longest,
    el('h3', {}, 'Tokens per day'),
    el(
      'figure',
      { class: 'heat llm-heat' },
      // Scrolls sideways on a narrow screen, starting at the latest week (stats.astro). The
      // caption gives the range, not dates under particular weeks, so scrolling cannot misplace
      // or clip them.
      el(
        'div',
        { class: 'llm-heat-scroll', tabindex: '0' },
        el(
          'div',
          { class: 'heat-cells', role: 'img', 'aria-label': summary },
          ...heat.cells.map(({ date: day, tokens: count, level }) =>
            el('i', {
              'data-l': String(level),
              ...(count === undefined
                ? {}
                : { title: `${dayMonth.format(utcDate(day))}: ${tokens(count)}` }),
            })
          )
        )
      ),
      el(
        'figcaption',
        { class: 'heat-cap' },
        el(
          'span',
          {},
          `${fullDate.format(utcDate(heat.from))} – ${fullDate.format(utcDate(heat.to))}`
        )
      )
    ),
  ];
}
