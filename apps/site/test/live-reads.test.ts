// What /stats and /uses show from the answers their browser scripts read (ADR 0014, ADR 0032):
// the readers against the contract's corpus and fixtures, and against the clock.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { desktopEnvelopeSchema, llmUsageEnvelopeSchema, staleAfterSeconds } from '@min7/contracts';
import { snapshotFixtures } from '@min7/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { desktopStaleAfterMs, readDesktop, uptime } from '../src/lib/desktop.ts';
import { hours, readLlmUsage } from '../src/lib/llm-usage.ts';

const corpus = (source: string) =>
  (['accept', 'reject'] as const).flatMap((kind) => {
    const dir = join(import.meta.dirname, '../../../packages/contracts/corpus', source, kind);
    return readdirSync(dir).map((file): [string, unknown] => [
      `${kind}/${file}`,
      JSON.parse(readFileSync(join(dir, file), 'utf8')),
    ]);
  });

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;

describe('agent hours and agents', () => {
  const taken = '2026-10-26T08:00:00.000Z';
  const envelope = (data: unknown, fields: object = {}) => ({
    source: 'llm-usage',
    version: 1,
    fetchedAt: taken,
    stale: false,
    data,
    ...fields,
  });
  const ok = snapshotFixtures['llm-usage'].ok;
  const at = (iso: string) => Date.parse(iso);

  // Catches the page showing hours the contract rejects (a negative or fractional value).
  it.each(corpus('llm-usage'))(
    'shows hours from %s only if the contract accepts them',
    (_f, body) => {
      const { fetchedAt, stale } = Object(body);
      const usage = readLlmUsage(body, Date.parse(String(fetchedAt)) + minute);
      const accepted = llmUsageEnvelopeSchema.safeParse(body).success && stale === false;
      if (!accepted) expect(usage?.monthMs ?? usage?.weekMs).toBeUndefined();
      const sent = Object(Object(body).data);
      if (accepted && Object(sent.monthToDate).activeMs !== undefined) {
        expect(usage?.monthMs).toBe(sent.monthToDate.activeMs);
      }
    }
  );

  // Catches a producer without hours shown as 0 hours, or a real 0 hidden.
  it('tells hours not sent from zero hours', () => {
    const minimal = readLlmUsage(envelope(snapshotFixtures['llm-usage'].minimal), at(taken));
    expect(minimal).toBeDefined();
    expect(minimal?.monthMs).toBeUndefined();
    expect(minimal?.weekMs).toBeUndefined();
    const zero = { ...ok, last7Days: { ...ok.last7Days, activeMs: 0 } };
    expect(readLlmUsage(envelope(zero), at(taken))?.weekMs).toBe(0);
    expect(hours(0)).toBe('0 hours');
  });

  // Catches "this month" shown for the previous month, or "last 7 days" a day off, after
  // midnight in Rabat while the tab stays open.
  it('shows the snapshot only on the date in Rabat it was taken', () => {
    expect(readLlmUsage(envelope(ok), at('2026-10-26T23:59:59Z'))?.monthMs).toBeDefined();
    expect(readLlmUsage(envelope(ok), at('2026-10-27T00:00:00Z'))).toBeUndefined();
    const lastOfMonth = envelope(ok, { fetchedAt: '2026-10-31T22:00:00Z' });
    expect(readLlmUsage(lastOfMonth, at('2026-11-01T00:30:00Z'))).toBeUndefined();
  });

  // Catches a snapshot from the future shown as current: the intake's clock tolerance is not the
  // browser's.
  it.each([1, 2, 3, 4, 5])('shows nothing from a snapshot %i min ahead', (ahead) => {
    expect(readLlmUsage(envelope(ok), at(taken) - ahead * minute)).toBeUndefined();
  });

  // Catches 30 February read as 2 March, the date in Rabat the browser is on.
  it('shows nothing from a snapshot dated on a day the calendar does not have', () => {
    const body = envelope(ok, { fetchedAt: '2026-02-30T08:00:00Z' });
    expect(readLlmUsage(body, at('2026-03-02T09:00:00Z'))).toBeUndefined();
  });

  it.each([
    ['stale', { stale: true }],
    ['of another source', { source: 'desktop' }],
    ['without a date', { fetchedAt: null }],
    ['without data', { data: null }],
  ])('shows nothing from an answer %s', (_case, fields) => {
    expect(readLlmUsage(envelope(ok, fields), at('2026-10-26T08:00:00Z'))).toBeUndefined();
  });

  it('lists the agents by name, as served, and drops a list it cannot read', () => {
    expect(readLlmUsage(envelope(ok), at(taken))?.agents).toEqual(['Claude Code', 'Codex', 'pi']);
    const broken = { ...ok, monthToDate: { ...ok.monthToDate, agents: [null] } };
    expect(readLlmUsage(envelope(broken), at(taken))?.agents).toBeUndefined();
  });

  it('rounds hours for display only', () => {
    expect(hours(517_889_547)).toBe('144 hours');
    expect(hours(34_932_547)).toBe('9.7 hours');
    expect(hours(3_600_000)).toBe('1 hour');
    expect(hours(7 * 25 * hour)).toBe('175 hours');
  });
});

describe('desktop facts', () => {
  const taken = Date.parse('2026-10-26T08:00:00.000Z');
  const envelope = (data: object = {}, fields: object = {}) => ({
    source: 'desktop',
    version: 1,
    fetchedAt: '2026-10-26T08:00:00.000Z',
    stale: false,
    data: { ...snapshotFixtures.desktop.ok, ...data },
    ...fields,
  });

  it('expires when the contract says the source is stale', () => {
    expect(desktopStaleAfterMs).toBe(staleAfterSeconds.desktop * 1000);
  });

  // Catches the page showing a value the contract rejects, such as a kernel with a host name.
  it.each(corpus('desktop'))('shows %s only if the contract accepts it', (_f, body) => {
    const { fetchedAt, stale } = Object(body);
    const accepted = desktopEnvelopeSchema.safeParse(body).success && stale === false;
    const facts = readDesktop(body, Date.parse(String(fetchedAt)) + minute);
    if (!accepted) expect(facts).toBeUndefined();
    else if (Object(body).data !== null) expect(facts).toBeDefined();
  });

  // Catches facts kept on screen after they expire, and a future report or boot time
  // turned into a believable uptime.
  it.each([
    ['2 days and a minute after the report', envelope(), taken + 2 * day + minute],
    ...[1, 2, 3, 4, 5].map((ahead): [string, object, number] => [
      `when the report is ${ahead} min ahead of the browser`,
      envelope(),
      taken - ahead * minute,
    ]),
    [
      'when the boot is after the report',
      envelope({ bootedAt: '2026-10-26T08:00:01.000Z' }),
      taken + hour,
    ],
    ['with a malformed boot time', envelope({ bootedAt: '26 Oct 2026' }), taken],
    // Date.parse would read 30 February as 2 March and show a believable uptime.
    [
      'with a boot on a day the calendar does not have',
      envelope({ bootedAt: '2026-02-30T12:00:00Z' }, { fetchedAt: '2026-03-03T12:00:00.000Z' }),
      Date.parse('2026-03-03T12:00:00Z'),
    ],
    [
      'with a report on a day the calendar does not have',
      envelope({ bootedAt: '2026-02-27T12:00:00Z' }, { fetchedAt: '2026-02-29T08:00:00.000Z' }),
      Date.parse('2026-03-01T09:00:00Z'),
    ],
    ['with a boot time not in UTC', envelope({ bootedAt: '2026-10-23T08:41:12+01:00' }), taken],
    ['with a kernel outside the allowlist', envelope({ kernel: '7.2.11-arch1-1-host' }), taken],
    ['when the API calls it stale', envelope({}, { stale: true }), taken],
  ])('shows nothing %s', (_case, body, now) => {
    expect(readDesktop(body, now)).toBeUndefined();
  });

  it('shows facts from the moment of the report up to 2 days old, and unreadable values as absent', () => {
    expect(readDesktop(envelope(), taken)).toBeDefined();
    expect(readDesktop(envelope(), taken + 2 * day)).toBeDefined();
    expect(readDesktop(envelope({ bootedAt: '2024-02-29T00:00:00Z' }), taken)).toBeDefined();
    expect(
      readDesktop(envelope({}, { fetchedAt: '2026-10-26T09:00:00.123456+01:00' }), taken + minute)
    ).toBeDefined();
    expect(readDesktop(envelope({ kernel: null, niri: null }), taken)).toMatchObject({
      kernel: null,
      niri: null,
    });
  });

  // Catches off-by-one rounding at the hour and day boundaries.
  it('rounds uptime down', () => {
    const boot = '2026-10-23T08:00:00.000Z';
    const since = (ms: number) => uptime(boot, Date.parse(boot) + ms);
    expect(since(59 * minute)).toBe('under an hour');
    expect(since(hour)).toBe('1 hour');
    expect(since(day - 1)).toBe('23 hours');
    expect(since(day)).toBe('1 day');
    expect(since(3 * day + 23 * hour)).toBe('3 days');
  });
});
