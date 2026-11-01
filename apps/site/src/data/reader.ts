// Reads source snapshots at build time, from the shared fixtures or the signals read API.
// Whatever happens upstream, a read resolves to an envelope: on any failure it is the empty
// envelope (`data: null`), so a page renders its empty state and the build goes on.
import {
  type DailySource,
  daysLast,
  type Envelope,
  isStale,
  type ListeningSnapshot,
  type LlmUsageDays,
  type LlmUsageSnapshot,
  listeningEnvelopeSchema,
  llmUsageDaysEnvelopeSchema,
  llmUsageEnvelopeSchema,
  type MonkeytypeSnapshot,
  monkeytypeEnvelopeSchema,
  type ProjectsSnapshot,
  projectsEnvelopeSchema,
  type ShippingActivityDays,
  type ShippingSnapshot,
  type SourceId,
  shippingActivityDaysEnvelopeSchema,
  shippingEnvelopeSchema,
  staleAfterSeconds,
} from '@min7/contracts';

const envelopeSchemas = {
  listening: listeningEnvelopeSchema,
  shipping: shippingEnvelopeSchema,
  projects: projectsEnvelopeSchema,
  monkeytype: monkeytypeEnvelopeSchema,
  'llm-usage': llmUsageEnvelopeSchema,
};

interface Snapshots {
  listening: ListeningSnapshot;
  shipping: ShippingSnapshot;
  projects: ProjectsSnapshot;
  monkeytype: MonkeytypeSnapshot;
  'llm-usage': LlmUsageSnapshot;
}

const daysSchemas = {
  'shipping-activity': shippingActivityDaysEnvelopeSchema,
  'llm-usage': llmUsageDaysEnvelopeSchema,
};

interface DaysBlocks {
  'shipping-activity': ShippingActivityDays;
  'llm-usage': LlmUsageDays;
}

/** Sources the build reads; shelf is read once it has a schema. */
export type ReadSource = keyof Snapshots;

export type SnapshotOf<Source extends ReadSource> = Snapshots[Source];

type SignalsMode = 'fixtures' | 'api';

export interface ReaderOptions {
  mode: SignalsMode;
  /** Origin of the signals read API, e.g. `https://api.ayagmar.dev`. */
  apiBase: string;
  /** Deadline for each API read, body included. */
  timeoutMs?: number;
  now?: () => Date;
  warn?: (message: string) => void;
}

/** The envelope of a source that has never succeeded: what pages render as empty. */
const emptyEnvelope = <Source extends SourceId>(source: Source): Envelope<never, Source> => ({
  source,
  version: 1,
  fetchedAt: null,
  stale: true,
  data: null,
});

export function createReader(options: ReaderOptions) {
  const { mode, apiBase, timeoutMs = 5_000, now = () => new Date(), warn = console.warn } = options;
  // Several pages read the same source; each build fetches it once.
  const reads = new Map<ReadSource, Promise<Envelope<unknown>>>();

  async function fromFixtures<Source extends ReadSource>(source: Source) {
    const { fixturesCapturedAt, snapshotFixtures } = await import('@min7/contracts/fixtures');
    return envelopeSchemas[source].parse({
      source,
      version: 1,
      fetchedAt: fixturesCapturedAt,
      stale: false,
      data: snapshotFixtures[source].ok,
    });
  }

  async function fromApi<Source extends SourceId>(
    source: Source,
    url: string,
    schema: { safeParse(value: unknown): { success: boolean; data?: unknown } }
  ): Promise<Envelope<unknown>> {
    try {
      const response = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const parsed = schema.safeParse(await response.json());
      if (!parsed.success) throw new Error('the response does not match the contract');
      return parsed.data as Envelope<unknown>;
    } catch (error) {
      // The reason only: never the response body.
      const reason =
        error instanceof Error && error.name === 'TimeoutError'
          ? `no answer within ${timeoutMs} ms`
          : error instanceof SyntaxError
            ? 'the response is not JSON'
            : error instanceof Error
              ? error.message
              : 'unknown error';
      warn(`signals: ${url} unavailable (${reason}); rendering the empty state`);
      return emptyEnvelope(source);
    }
  }

  /** The latest snapshot of `source`, with `stale` recomputed for the time of the build. */
  async function read<Source extends ReadSource>(
    source: Source
  ): Promise<Envelope<SnapshotOf<Source>, Source>> {
    let pending = reads.get(source);
    if (pending === undefined) {
      pending =
        mode === 'fixtures'
          ? fromFixtures(source)
          : fromApi(source, `${apiBase}/v1/${source}`, envelopeSchemas[source]);
      reads.set(source, pending);
    }
    // Each entry was read with `source`'s own schema.
    const envelope = (await pending) as Envelope<SnapshotOf<Source>, Source>;
    return {
      ...envelope,
      stale: isStale(envelope.fetchedAt, staleAfterSeconds[source], now()),
    };
  }

  const dayReads = new Map<DailySource, Promise<Envelope<unknown>>>();

  /**
   * The last 28 days of `series`' daily history (ADR 0038), `/v1/days/<series>?last=28`, read
   * once per build like `read`, with `stale` recomputed for the time of the build.
   */
  async function readDays<Series extends DailySource>(
    series: Series
  ): Promise<Envelope<DaysBlocks[Series], Series>> {
    let pending = dayReads.get(series);
    if (pending === undefined) {
      pending =
        mode === 'fixtures'
          ? import('@min7/contracts/fixtures').then(({ fixturesCapturedAt, daysFixtures }) => {
              const fixtures: Partial<Record<DailySource, { ok: unknown }>> = daysFixtures;
              const block = fixtures[series]?.ok;
              return block === undefined
                ? emptyEnvelope(series)
                : daysSchemas[series].parse({
                    source: series,
                    version: 1,
                    fetchedAt: fixturesCapturedAt,
                    stale: false,
                    data: block,
                  });
            })
          : fromApi(series, `${apiBase}/v1/days/${series}?last=${daysLast}`, daysSchemas[series]);
      dayReads.set(series, pending);
    }
    // Each entry was read with `series`' own schema.
    const envelope = (await pending) as Envelope<DaysBlocks[Series], Series>;
    return {
      ...envelope,
      stale: isStale(envelope.fetchedAt, staleAfterSeconds[series], now()),
    };
  }

  return { read, readDays };
}
