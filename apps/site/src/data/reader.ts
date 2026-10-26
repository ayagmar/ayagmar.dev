// Reads source snapshots at build time, from the shared fixtures or the signals read API.
// Whatever happens upstream, a read resolves to an envelope: on any failure it is the empty
// envelope (`data: null`), so a page renders its empty state and the build goes on.
import {
  type Envelope,
  isStale,
  type ListeningSnapshot,
  listeningEnvelopeSchema,
  type ProjectsSnapshot,
  projectsEnvelopeSchema,
  type ShippingSnapshot,
  type SourceId,
  shippingEnvelopeSchema,
  staleAfterSeconds,
} from '@min7/contracts';

const envelopeSchemas = {
  listening: listeningEnvelopeSchema,
  shipping: shippingEnvelopeSchema,
  projects: projectsEnvelopeSchema,
};

interface Snapshots {
  listening: ListeningSnapshot;
  shipping: ShippingSnapshot;
  projects: ProjectsSnapshot;
}

/** Sources pulled by signals; the pushed ones (llm-usage, shelf) are read once they have schemas. */
export type PulledSource = keyof Snapshots;

export type SnapshotOf<Source extends PulledSource> = Snapshots[Source];

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
export const emptyEnvelope = <Source extends SourceId>(
  source: Source
): Envelope<never, Source> => ({
  source,
  version: 1,
  fetchedAt: null,
  stale: true,
  data: null,
});

export function createReader(options: ReaderOptions) {
  const { mode, apiBase, timeoutMs = 5_000, now = () => new Date(), warn = console.warn } = options;
  // Several pages read the same source; each build fetches it once.
  const reads = new Map<PulledSource, Promise<Envelope<unknown>>>();

  async function fromFixtures<Source extends PulledSource>(source: Source) {
    const { snapshotFixtures } = await import('@min7/contracts/fixtures');
    return envelopeSchemas[source].parse({
      source,
      version: 1,
      fetchedAt: now().toISOString(),
      stale: false,
      data: snapshotFixtures[source].ok,
    });
  }

  async function fromApi<Source extends PulledSource>(source: Source) {
    const url = `${apiBase}/v1/${source}`;
    try {
      const response = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const parsed = envelopeSchemas[source].safeParse(await response.json());
      if (!parsed.success) throw new Error('the response does not match the contract');
      return parsed.data;
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
  async function read<Source extends PulledSource>(
    source: Source
  ): Promise<Envelope<SnapshotOf<Source>, Source>> {
    let pending = reads.get(source);
    if (pending === undefined) {
      pending = mode === 'fixtures' ? fromFixtures(source) : fromApi(source);
      reads.set(source, pending);
    }
    // Each entry was read with `source`'s own schema.
    const envelope = (await pending) as Envelope<SnapshotOf<Source>, Source>;
    return {
      ...envelope,
      stale: isStale(envelope.fetchedAt, staleAfterSeconds[source], now()),
    };
  }

  return { read };
}
