// Estimated agent hours on /stats (ADR 0014): this month's and the last 7 days', read from
// signals by the browser and shown only on the date in Rabat the snapshot was taken. The block
// is hidden in the page's HTML and stays hidden without this script, in fixtures mode (no
// endpoint), and whenever the last answer has no hours or no longer holds.

import { poll, timeElement, utcTime } from '../lib/live.ts';
import { hours, readLlmUsage } from '../lib/llm-usage.ts';

const block = document.querySelector<HTMLElement>('.agent-hours');
const empty = document.querySelector<HTMLElement>('.llm-usage-empty');
// `${SIGNALS_API_BASE}/v1/llm-usage`, absent in fixtures mode: then no request.
const endpoint = block?.dataset.llmUsageSrc;

if (block && endpoint) {
  const rows = {
    month: block.querySelector<HTMLElement>('.agent-hours-month'),
    week: block.querySelector<HTMLElement>('.agent-hours-week'),
  };
  const asOf = block.querySelector('.agent-hours-as-of');
  let shown = '';
  // The producer pushes every 6 hours; asking every 30 minutes is plenty.
  poll(endpoint, 30 * 60_000, (answer, now) => {
    const usage = readLlmUsage(answer, now);
    const values = { month: usage?.monthMs, week: usage?.weekMs };
    const visible = values.month !== undefined || values.week !== undefined;
    const key = visible ? JSON.stringify([usage?.fetchedAt, values]) : '';
    if (key === shown) return;
    shown = key;
    for (const [name, row] of Object.entries(rows)) {
      const value = values[name as keyof typeof values];
      const dd = row?.querySelector('dd');
      if (!row || !dd) continue;
      // A missing value is left out, never shown as 0 hours.
      row.hidden = value === undefined;
      dd.textContent = value === undefined ? '' : hours(value);
    }
    if (usage && asOf) {
      asOf.replaceChildren(
        'As of ',
        timeElement(usage.fetchedAt, utcTime(Date.parse(usage.fetchedAt))),
        '.'
      );
    }
    block.hidden = !visible;
    if (empty) empty.hidden = visible;
  });
}
