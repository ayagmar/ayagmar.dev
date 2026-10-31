import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { poll } from '../src/lib/live.ts';

// When a live panel asks signals (src/lib/live.ts): the page's clock, visibility, tab events
// and network are faked; nothing else is.
const minute = 60_000;
const endpoint = 'https://api.ayagmar.dev/v1/shipping';

let hidden: boolean;
let page: EventTarget;
let tab: EventTarget;
let answers: (() => Promise<Response>)[];
let asked: number;
let shown: { answer: unknown; failed: boolean }[];

const ok = (body: unknown) => () => Promise.resolve(Response.json(body));

beforeEach(() => {
  vi.useFakeTimers({ now: Date.parse('2026-10-26T12:00:00Z') });
  hidden = false;
  page = new EventTarget();
  Object.defineProperty(page, 'hidden', { get: () => hidden });
  tab = new EventTarget();
  vi.stubGlobal('document', page);
  vi.stubGlobal('window', tab);
  answers = [];
  asked = 0;
  vi.stubGlobal('fetch', () => {
    asked++;
    return (answers.shift() ?? ok({ n: asked }))();
  });
  shown = [];
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Starts polling every `everyMs` and lets the first answer arrive. */
async function start(everyMs: number) {
  poll(endpoint, everyMs, (answer, _now, failed) => shown.push({ answer, failed }));
  await vi.advanceTimersByTimeAsync(0);
}

/** The tab comes back: shown again, then the events a browser sends for it. */
async function comeBack(...events: string[]) {
  hidden = false;
  for (const name of events)
    (name === 'visibilitychange' ? page : tab).dispatchEvent(new Event(name));
  await vi.advanceTimersByTimeAsync(0);
}

describe('a live panel', () => {
  // Catches a tab that slept showing what it had when it hid until its own pace comes round.
  it('asks at once when a tab hidden for 10 minutes is shown, and not while hidden', async () => {
    await start(15 * minute);
    expect(asked).toBe(1);
    hidden = true;
    page.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(10 * minute);
    expect(asked).toBe(1);
    await comeBack('visibilitychange', 'focus');
    expect(asked).toBe(2);
    expect(shown.at(-1)).toEqual({ answer: { n: 2 }, failed: false });
  });

  // Catches a request per focus when someone switches windows back and forth.
  it('does not ask again when the tab comes back within a minute of its last request', async () => {
    await start(5 * minute);
    await vi.advanceTimersByTimeAsync(59_000);
    await comeBack('visibilitychange', 'focus', 'pageshow');
    expect(asked).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000);
    await comeBack('focus');
    expect(asked).toBe(2);
    // Then at its own pace, counted from that request.
    await vi.advanceTimersByTimeAsync(4 * minute);
    expect(asked).toBe(2);
    await vi.advanceTimersByTimeAsync(minute);
    expect(asked).toBe(3);
  });

  // Catches a tab restored from the back/forward cache, whose timers did not run, showing
  // what it showed hours ago.
  it('asks when the page is restored from the back/forward cache', async () => {
    await start(30 * minute);
    vi.setSystemTime(Date.now() + 3 * 60 * minute);
    await comeBack('pageshow');
    expect(asked).toBe(2);
  });

  // Catches requests piling up behind one that hangs.
  it('asks one request at a time', async () => {
    answers.push(ok({ n: 1 }), () => new Promise(() => {}));
    await start(minute);
    await vi.advanceTimersByTimeAsync(minute);
    expect(asked).toBe(2);
    await vi.advanceTimersByTimeAsync(3 * minute);
    await comeBack('visibilitychange', 'focus');
    expect(asked).toBe(2);
  });

  // Catches a good answer dropped, or still called current, when a later request fails.
  it('keeps the last answer through failures, saying they failed', async () => {
    answers.push(
      ok({ n: 1 }),
      () => Promise.resolve(new Response('{}', { status: 500 })),
      () => Promise.reject(new TypeError('offline')),
      () => Promise.resolve(new Response('{"source":', { status: 200 }))
    );
    await start(minute);
    for (const _ of [1, 2, 3]) {
      await vi.advanceTimersByTimeAsync(minute);
      expect(shown.at(-1)).toEqual({ answer: { n: 1 }, failed: true });
    }
    await vi.advanceTimersByTimeAsync(minute);
    expect(shown.at(-1)).toEqual({ answer: { n: 5 }, failed: false });
  });

  // Catches a fixtures-mode build (public Previews) asking the production API.
  it('asks nothing without an endpoint, and still shows', async () => {
    poll(undefined, minute, (answer, _now, failed) => shown.push({ answer, failed }));
    await comeBack('visibilitychange');
    await vi.advanceTimersByTimeAsync(10 * minute);
    expect(asked).toBe(0);
    expect(shown.length).toBeGreaterThan(10);
  });
});
