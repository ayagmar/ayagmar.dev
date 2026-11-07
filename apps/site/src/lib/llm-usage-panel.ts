/**
 * The LLM usage panel on /stats (ADR 0014): its words, numbers and markup, drawn by the build
 * and again by the browser for each newer answer (src/scripts/stats-live.ts).
 */
import type { LlmUsageSnapshot } from '@min7/contracts';
import { dayMs, isoDate, rabatDate, utcDate } from '@min7/contracts/rabat';
import { heatmap, noRecordWords } from './heat.ts';
import { el, type Markup } from './markup.ts';
import { plural } from './plural.ts';
import { dateRange, dayWords, shortDate, tokens } from './words.ts';

const hourMs = 3_600_000;

/** `283 hours`, `7.5 hours`, `0 hours`: whole hours from 10 up, one decimal below. */
export function hours(ms: number): string {
  const value = ms / hourMs;
  const shown = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return plural(shown, 'hour', 'hours');
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
      `Streak on ${dayWords(date)}: ${plural(streak.currentDays, 'day', 'days')}.`
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
  const summary = `${
    heat.activeDays === 0 || !heat.busiest?.tokens
      ? `Tokens per day from ${shortDate(heat.from)} to ${shortDate(heat.to)}: none.`
      : `Tokens per day from ${shortDate(heat.from)} to ${shortDate(heat.to)}: ${plural(heat.activeDays, 'day', 'days')} with use, the busiest ${shortDate(heat.busiest.date)} with ${tokens(heat.busiest.tokens)}.`
  }${heat.gaps ? ' Some days have no record.' : ''}`;
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
              'data-l': String(level ?? 'none'),
              ...(count === undefined ? {} : { title: `${dayWords(day)}: ${tokens(count)}` }),
            })
          )
        )
      ),
      el(
        'figcaption',
        { class: 'heat-cap' },
        el('span', {}, `${shortDate(heat.from)} – ${shortDate(heat.to)}`),
        // How the squares look means nothing to a screen reader or the text copy: their words are
        // in the summary above.
        ...(heat.gaps
          ? [el('span', { 'aria-hidden': 'true' }, `Squares: ${noRecordWords('faint')}`)]
          : [])
      )
    ),
  ];
}
