// The build's reader, configured from the environment (ADR 0015).

import { SIGNALS_API_BASE, SIGNALS_MODE } from 'astro:env/server';
import { type Envelope, staleAfterSeconds } from '@min7/contracts';
import { createReader, type ReadSource } from './reader.ts';

export const signalsMode = SIGNALS_MODE;

/** Origin of the read API; pages read from it in the browser in `api` mode. */
export const signalsApiBase = SIGNALS_API_BASE.replace(/\/+$/, '');

export const signals = createReader({ mode: signalsMode, apiBase: signalsApiBase });

/**
 * The attributes of a panel the browser keeps current (src/lib/live.ts, ADR 0015): which
 * source, when the build's snapshot was taken, the source's stale threshold, and in api mode
 * the endpoint. In fixtures mode there is no endpoint and no request.
 */
export const liveAttrs = (source: ReadSource, envelope: Envelope<unknown>) => ({
  'data-live': source,
  'data-live-src': signalsMode === 'api' ? `${signalsApiBase}/v1/${source}` : undefined,
  'data-fetched-at': envelope.data === null ? undefined : (envelope.fetchedAt ?? undefined),
  'data-stale-after': staleAfterSeconds[source],
});
