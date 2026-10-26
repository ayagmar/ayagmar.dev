<script lang="ts">
import { onMount } from 'svelte';

interface Track {
  track: string;
  artist: string;
  url: string | null;
}

interface Props {
  /** The track playing when the site was built, or null. */
  initial: Track | null;
  /** When that value was fetched (RFC 3339), or null when listening data never loaded. */
  asOf: string | null;
  /** `${SIGNALS_API_BASE}/v1/listening`, or null to stay on the build-time value (fixtures mode). */
  endpoint: string | null;
  /** How long after its `fetchedAt` an answer counts as now: listening's `staleAfterSeconds`. */
  liveForMs: number;
}

const { initial, asOf, endpoint, liveForMs }: Props = $props();

const refreshMs = 60_000;
// A server clock up to this far ahead of the visitor's is still believable.
const skewMs = 2 * 60_000;

// Svelte keeps the first prop values; later props never change on a static page.
// svelte-ignore state_referenced_locally
let current = $state<{ track: Track | null; asOf: string | null; live: boolean }>({
  track: initial,
  asOf,
  live: false,
});
// When the live answer stops being now. The refresh timer checks it before it asks again, so
// the record stops within a minute of it even while requests hang or fail.
let liveUntil = 0;

function expire() {
  if (current.live && Date.now() >= liveUntil) current.live = false;
}

/** A track from the API, or undefined when the response is not one the island understands. */
function readTrack(value: unknown): Track | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'object') return undefined;
  const { track, artist, url } = value as Record<string, unknown>;
  if (typeof track !== 'string' || typeof artist !== 'string') return undefined;
  // The link must stay on Last.fm, whatever the API says.
  const href = typeof url === 'string' && url.startsWith('https://www.last.fm/') ? url : null;
  return { track, artist, url: href };
}

/** The answer at `url`, or undefined when it failed or is not one the island understands. */
async function read(url: string) {
  try {
    const response = await fetch(url, { headers: { accept: 'application/json' } });
    if (!response.ok) return undefined;
    const body: unknown = await response.json();
    if (typeof body !== 'object' || body === null) return undefined;
    const { source, stale, fetchedAt, data } = body as Record<string, unknown>;
    if (source !== 'listening' || typeof stale !== 'boolean' || typeof fetchedAt !== 'string')
      return undefined;
    // A time that does not parse, or one from the future, says nothing about now.
    const at = Date.parse(fetchedAt);
    if (!Number.isFinite(at) || at > Date.now() + skewMs) return undefined;
    if (typeof data !== 'object' || data === null) return undefined;
    const track = readTrack((data as Record<string, unknown>).nowPlaying);
    if (track === undefined) return undefined;
    return { track, fetchedAt, at, stale };
  } catch {
    // Offline or blocked.
    return undefined;
  }
}

async function refresh(url: string) {
  const answer = await read(url);
  if (answer === undefined) {
    // Keep the last track and its time, but no longer as now.
    current.live = false;
    return;
  }
  liveUntil = answer.at + liveForMs;
  current = {
    track: answer.track,
    asOf: answer.fetchedAt,
    live: !answer.stale && Date.now() < liveUntil,
  };
}

onMount(() => {
  if (endpoint === null) return;
  const url = endpoint;
  void refresh(url);
  const timer = setInterval(() => {
    expire();
    if (document.visibilityState === 'visible') void refresh(url);
  }, refreshMs);
  const onVisible = () => {
    if (document.visibilityState !== 'visible') return;
    // A sleeping tab may not have run the expiry timer.
    expire();
    void refresh(url);
  };
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
  };
});

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (value: number) => String(value).padStart(2, '0');

/** `26 Oct, 09:00 UTC`: the same text on the build machine and in every browser. */
function utc(iso: string): string {
  const date = new Date(iso);
  return `${date.getUTCDate()} ${months[date.getUTCMonth()]}, ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`;
}
</script>

<!-- Announced politely and whole, and only when the text changes: a new track or a first live answer. -->
<p
  class="now-playing"
  aria-live="polite"
  aria-atomic="true"
  data-playing={current.live && current.track !== null ? '' : undefined}
>
  {#if current.asOf === null}
    Listening data is not available.
  {:else if current.track === null}
    Nothing playing
    {#if current.live}
      right now.
    {:else}
      as of <time datetime={current.asOf}>{utc(current.asOf)}</time>.
    {/if}
  {:else}
    {current.live ? 'Now playing' : 'Playing'}
    {#if current.track.url === null}
      <cite>{current.track.track}</cite>
    {:else}
      <a href={current.track.url}><cite>{current.track.track}</cite></a>
    {/if}
    by {current.live ? `${current.track.artist}.` : current.track.artist}
    {#if !current.live}
      as of <time datetime={current.asOf}>{utc(current.asOf)}</time>.
    {/if}
  {/if}
</p>
