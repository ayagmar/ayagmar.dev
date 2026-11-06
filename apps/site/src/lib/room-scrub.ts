/**
 * The room's scrub without the page (ADR 0044): which date is held, which month blocks are asked
 * for and when, and when a date has settled. What shows is always worked out from the date and the
 * blocks held at that moment, so an answer that arrives late, in any order, can only fill in the
 * date it belongs to: there is nothing to cancel, and nothing of a date the reader has left to
 * show.
 */
import {
  dateBack,
  dayFacts,
  daysBack,
  type Lookup,
  monthsFor,
  readBlock,
  type Series,
} from './room-day.ts';
import type { PastDay } from './room-state.ts';

/** How long a date must hold before its months are asked for: a drag asks only where it rests. */
const settleMs = 200;
/** How long a settled date waits to be announced, so a run of key presses says one thing. */
const sayMs = 800;
/** How long a failed month is left alone, so a source that is down is not asked at every date. */
const retryMs = 60_000;

/**
 * What the slider's `value` asks for: days back from `anchor`, the today its numbers were set
 * against, which may have passed. A date that has not ended by `today` is now, null.
 */
export function dateAt(value: number, anchor: string, today: string): string | null {
  const date = dateBack(anchor, -value);
  return date < today ? date : null;
}

/** The slider's value for `date`, null being now, on the axis anchored at `today`. */
export const valueAt = (date: string | null, today: string) =>
  date === null ? 0 : -daysBack(date, today);

export interface ScrubPorts {
  /** The body `/v1/days/<series>?month=<month>` answers with, undefined if the request failed. */
  ask(series: Series, month: string): Promise<unknown>;
  now(): number;
  /** Shows `date` with what is known of it, or the room as it is now for null. */
  show(date: string | null, facts: PastDay | null): void;
  /** Called once when `date` has settled and all its months are answered. */
  say(date: string, facts: PastDay): void;
}

type Entry = { block: unknown } | { failedAt: number } | 'asked';

export function scrubber({ ask, now, show, say }: ScrubPorts) {
  const entries = new Map<string, Entry>();
  let held: string | null = null;
  let settle: ReturnType<typeof setTimeout> | undefined;
  let announce: ReturnType<typeof setTimeout> | undefined;
  let settled = false;

  const keyOf = (series: Series, month: string) => `${series} ${month}`;

  const lookup = ((series: Series, month: string) => {
    const entry = entries.get(keyOf(series, month));
    if (entry === undefined || entry === 'asked') return 'waiting';
    return 'block' in entry ? entry.block : 'failed';
  }) as Lookup;

  const answered = (date: string) =>
    monthsFor(date).every(([series, month]) => lookup(series, month) !== 'waiting');

  function sayOnceAnswered() {
    const date = held;
    if (date === null || !settled || !answered(date) || announce !== undefined) return;
    announce = setTimeout(() => say(date, dayFacts(date, lookup)), sayMs);
  }

  function load(series: Series, month: string) {
    const key = keyOf(series, month);
    const entry = entries.get(key);
    if (entry === 'asked' || (entry !== undefined && 'block' in entry)) return;
    if (entry !== undefined && now() - entry.failedAt < retryMs) return;
    entries.set(key, 'asked');
    ask(series, month).then((body) => {
      const block = readBlock(series, month, body, now());
      entries.set(key, block === undefined ? { failedAt: now() } : { block });
      if (held === null || !monthsFor(held).some(([s, m]) => keyOf(s, m) === key)) return;
      show(held, dayFacts(held, lookup));
      sayOnceAnswered();
    });
  }

  /** Holds `date`, or returns to the room as it is now with null. */
  function go(date: string | null) {
    held = date;
    settled = false;
    clearTimeout(settle);
    clearTimeout(announce);
    announce = undefined;
    if (date === null) {
      show(null, null);
      return;
    }
    show(date, dayFacts(date, lookup));
    settle = setTimeout(() => {
      settled = true;
      for (const [series, month] of monthsFor(date)) load(series, month);
      sayOnceAnswered();
    }, settleMs);
  }

  return { go };
}
