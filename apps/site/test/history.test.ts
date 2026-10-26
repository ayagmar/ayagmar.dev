import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { listeningHistoryEnvelopeSchema } from '@min7/contracts';
import { snapshotFixtures } from '@min7/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { knowsRabatDate, readHistory, yearLine } from '../src/lib/history.ts';

const corpus = join(import.meta.dirname, '../../../packages/contracts/corpus/listening-history');

/**
 * Noon UTC on the day `date` starts with, which is that date in Rabat at +00 and at +01;
 * 2026-10-26 when it has none.
 */
const noonOn = (date: unknown) => {
  const [, year = 2026, month = 10, day = 26] =
    /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date))?.map(Number) ?? [];
  return Date.UTC(year, month - 1, day, 12);
};

const envelope = (data: unknown, fields: Record<string, unknown> = {}) => ({
  source: 'listening-history',
  version: 1,
  fetchedAt: '2026-10-26T00:03:12.000Z',
  stale: false,
  data,
  ...fields,
});

describe('which answers /stats shows', () => {
  // Catches the page showing a history the contract rejects, or hiding one it accepts: the
  // contract's whole corpus and every snapshot fixture, each read on its own date.
  const cases: [string, unknown][] = [
    ...(['accept', 'reject'] as const).flatMap((kind) =>
      readdirSync(join(corpus, kind)).map((file): [string, unknown] => [
        `${kind}/${file}`,
        JSON.parse(readFileSync(join(corpus, kind, file), 'utf8')),
      ])
    ),
    ...Object.entries(snapshotFixtures['listening-history']).map(
      ([name, data]): [string, unknown] => [`snapshot/${name}`, envelope(data)]
    ),
  ];
  it.each(cases)('agrees with the contract on %s', (_name, body) => {
    const { stale, data } = Object(body);
    const shown =
      listeningHistoryEnvelopeSchema.safeParse(body).success && stale === false && data !== null;
    expect(readHistory(body, noonOn(Object(data).describedDate)) !== undefined).toBe(shown);
  });

  // Catches yesterday's history shown after midnight in Rabat, or today's hidden before it,
  // at +00 (2026) and at +01 (2025), where midnight is 23:00 UTC the day before.
  it.each([
    ['2026-10-26', '2026-10-26T00:00:00Z', '2026-10-27T00:00:00Z'],
    ['2025-10-26', '2025-10-25T23:00:00Z', '2025-10-26T23:00:00Z'],
  ])('shows the history for %s from its midnight in Rabat to the next', (date, from, to) => {
    const body = envelope({ ...snapshotFixtures['listening-history'].ok, describedDate: date });
    expect(readHistory(body, Date.parse(from) - 1)).toBeUndefined();
    expect(readHistory(body, Date.parse(from))?.describedDate).toBe(date);
    expect(readHistory(body, Date.parse(to) - 1)?.describedDate).toBe(date);
    expect(readHistory(body, Date.parse(to))).toBeUndefined();
  });

  it.each([
    ['a stale answer', { stale: true }],
    ['another source', { source: 'listening' }],
    ['another version', { version: 2 }],
    ['an unreadable fetchedAt', { fetchedAt: 'today' }],
  ])('shows nothing for %s', (_case, fields) => {
    const now = Date.parse('2026-10-26T12:00:00Z');
    expect(readHistory(envelope(snapshotFixtures['listening-history'].ok), now)).toBeDefined();
    expect(
      readHistory(envelope(snapshotFixtures['listening-history'].ok, fields), now)
    ).toBeUndefined();
  });
});

// Node's tzdata has Morocco's 2026 rules; a browser without them shows no history.
it('knows the Rabat date by current rules here', () => {
  expect(knowsRabatDate()).toBe(true);
});

describe('the words for a year', () => {
  const join = (line: ReturnType<typeof yearLine>) => `${line.before}${line.track}${line.after}`;

  // Catches a top track of a partly read day presented as the day's own.
  it('says when the top track is only the top of what was read', () => {
    const [ok] = snapshotFixtures['listening-history'].ok.years;
    const [approximate] = snapshotFixtures['listening-history'].approximate.years;
    expect(ok && join(yearLine(ok))).toBe(
      '2025: 29 scrobbles. Most played: Nowhere to Run by LTN, 2 times.'
    );
    expect(approximate && join(yearLine(approximate))).toMatch(
      /^\d{4}: 450 scrobbles\. Most played of the 200 read: .+, 16 times\.$/
    );
    const [single] = snapshotFixtures['listening-history']['single-item'].years;
    expect(single && join(yearLine(single))).toBe(
      '2025: 1 scrobble. Most played: Says by Nils Frahm, 1 time.'
    );
  });
});
