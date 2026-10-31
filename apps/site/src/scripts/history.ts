// "On this day" on /stats (ADR 0030): what was played on today's date in Rabat in past years,
// from signals, shown only while the snapshot is for today's date there. The block is hidden
// in the page's HTML and stays hidden without this script, in fixtures mode (no endpoint), in
// a browser that does not know Morocco's current clock rules (the date there would be an hour
// off around midnight), and whenever the last answer is unusable or for another date.
import { nextDate, rabatDayStart } from '@min7/contracts/rabat';
import {
  dayName,
  type HistoryYear,
  knowsRabatDate,
  readHistory,
  yearLine,
} from '../lib/history.ts';
import { due } from '../lib/live.ts';
import { el, toNode } from '../lib/markup.ts';

const block = document.querySelector<HTMLElement>('.history');
// `${SIGNALS_API_BASE}/v1/listening-history`, absent in fixtures mode: then no request.
const endpoint = knowsRabatDate() ? block?.dataset.historySrc : undefined;

// The last answer, read again on every check so that it shows only on the date it is for.
let answer: unknown;
// When the last request started (ms); never yet.
let asked: number | undefined;
let pending = false;
// What is on the page now, so a check that changes nothing leaves the DOM alone.
let shown = '';
let midnight: ReturnType<typeof setTimeout> | undefined;

/**
 * Asks signals while the page is visible, one request at a time: on load, then every 5
 * minutes while there is nothing for today to show (signals publishes a new date's history
 * within minutes of midnight), and hourly once there is; when the tab comes back, once the
 * last request is a minute old (src/lib/live.ts). Given up after 5 s.
 */
function refresh(now: number, current: boolean, returned: boolean) {
  if (!endpoint || pending || document.hidden) return;
  if (asked !== undefined && !due(now - asked, (current ? 60 : 5) * 60_000, returned)) return;
  asked = now;
  pending = true;
  fetch(endpoint, { signal: AbortSignal.timeout(5_000) })
    // An error status is a failure, whatever its body says.
    .then((response) => response.ok && response.json())
    .catch(() => {})
    .then((body) => {
      pending = false;
      answer = body;
      check();
    });
}

/**
 * Shows the history if it is for today in Rabat, else hides it; then asks again if due.
 * `returned` when the tab has just come back.
 */
function check(returned = false) {
  if (!block || !endpoint) return;
  const now = Date.now();
  const history = readHistory(answer, now);
  const key = history ? JSON.stringify(history) : '';
  if (key !== shown) {
    shown = key;
    if (history) render(block, history.describedDate, history.years);
    block.hidden = !history;
  }
  // Hide it the moment the date changes in Rabat, whatever the minute tick does.
  clearTimeout(midnight);
  if (history) {
    midnight = setTimeout(
      () => check(),
      rabatDayStart(nextDate(history.describedDate)) * 1000 - now
    );
  }
  refresh(now, history !== undefined, returned);
}

function render(block: HTMLElement, date: string, years: HistoryYear[]) {
  const caption = block.querySelector('.history-date');
  const list = block.querySelector('ol');
  const empty = block.querySelector<HTMLElement>('.history-empty');
  if (!caption || !list || !empty) return;
  const time = document.createElement('time');
  time.dateTime = date;
  time.textContent = dayName(date);
  caption.replaceChildren(time);
  // Text only: titles and artists are Last.fm's, so never markup.
  list.replaceChildren(...years.map((year) => toNode(el('li', {}, ...yearLine(year)))));
  list.hidden = years.length === 0;
  empty.hidden = years.length > 0;
}

check();
setInterval(() => check(), 60_000);
// A tab that slept, or came back from the back/forward cache, checks the date at once.
const back = () => check(true);
document.addEventListener('visibilitychange', back);
window.addEventListener('focus', back);
window.addEventListener('pageshow', back);
