// The live part of /uses (ADR 0032, ADR 0015): the desktop's kernel, niri version and uptime
// as its producer last reported them, and this month's agents from /v1/llm-usage. Each part is
// hidden in the page's HTML, shown only while its last answer holds, and hidden on its own;
// the panel holding them shows only while one of them does. In fixtures mode there is no
// endpoint, no request and no panel.
import { readDesktop, uptime } from '../lib/desktop.ts';
import { poll, stamp, tick } from '../lib/live.ts';
import { readLlmUsage } from '../lib/llm-usage.ts';

const panel = document.querySelector<HTMLElement>('.uses-live');
const desktop = panel?.querySelector<HTMLElement>('.desktop-facts');
const agents = panel?.querySelector<HTMLElement>('.agents-month');

const update = () => {
  if (panel) panel.hidden = !!desktop?.hidden && !!agents?.hidden;
};

/** Sets the `<dd>` after the `<dt>` of `row` and hides the pair when there is no value. */
function setRow(block: HTMLElement, row: string, value: string | null) {
  const dd = block.querySelector<HTMLElement>(`.${row} dd`);
  const pair = block.querySelector<HTMLElement>(`.${row}`);
  if (!dd || !pair) return;
  pair.hidden = value === null;
  dd.textContent = value ?? '';
}

const desktopSrc = desktop?.dataset.desktopSrc;
if (desktop && desktopSrc) {
  // The facts change on reboot or upgrade and are pushed at login and daily.
  poll(desktopSrc, 30 * 60_000, (answer, now) => {
    const facts = readDesktop(answer, now);
    if (facts) {
      setRow(desktop, 'desktop-kernel', facts.kernel);
      setRow(desktop, 'desktop-niri', facts.niri);
      setRow(
        desktop,
        'desktop-uptime',
        `${uptime(facts.bootedAt, now)}, from the last reported boot`
      );
      desktop
        .querySelector('.desktop-reported')
        ?.replaceChildren('Reported ', stamp(facts.fetchedAt));
    }
    desktop.hidden = !facts;
    update();
    tick(now);
  });
}

const agentsSrc = agents?.dataset.llmUsageSrc;
if (agents && agentsSrc) {
  let shown = '';
  poll(agentsSrc, 30 * 60_000, (answer, now) => {
    const usage = readLlmUsage(answer, now);
    const names = usage?.agents?.length ? usage.agents : undefined;
    const key = names ? JSON.stringify([usage?.fetchedAt, names]) : '';
    if (key !== shown) {
      shown = key;
      if (usage && names) {
        // Text only: the names come from signals.
        agents.querySelector('ol')?.replaceChildren(
          ...names.map((name) => {
            const item = document.createElement('li');
            item.textContent = name;
            return item;
          })
        );
        agents.querySelector('.agents-as-of')?.replaceChildren('Updated ', stamp(usage.fetchedAt));
      }
      agents.hidden = !names;
    }
    update();
    tick(now);
  });
}
