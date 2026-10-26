<script lang="ts">
import { onMount } from 'svelte';

// The parts of Pagefind's browser API this island uses.
interface Result {
  url: string;
  excerpt: string;
  meta: { title?: string };
  /** Set on post pages by `data-pagefind-filter="project"`. */
  filters: { project?: string[] };
}
interface Pagefind {
  debouncedSearch(term: string): Promise<{ results: { data(): Promise<Result> }[] } | null>;
}

// Written by `pagefind` after the Astro build, so not resolvable at build time.
const bundle = '/pagefind/pagefind.js';
const limit = 8;

let hydrated = $state(false);
let dialog = $state<HTMLDialogElement>();
let query = $state('');
let results = $state<Result[]>([]);
let status = $state('');
let pagefind: Promise<Pagefind> | undefined;

onMount(() => {
  hydrated = true;
});

function open() {
  dialog?.showModal();
}

function isTyping(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

function onKeydown(event: KeyboardEvent) {
  const shortcut =
    ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') ||
    (event.key === '/' && !isTyping(event.target));
  if (!shortcut || dialog?.open) return;
  event.preventDefault();
  open();
}

async function search() {
  const term = query.trim();
  if (term === '') {
    results = [];
    status = '';
    return;
  }
  pagefind ??= import(/* @vite-ignore */ bundle);
  try {
    const found = await (await pagefind).debouncedSearch(term);
    if (found === null) return; // A newer keystroke superseded this search.
    results = await Promise.all(found.results.slice(0, limit).map((result) => result.data()));
    status = results.length === 0 ? 'No results.' : `${results.length} results.`;
  } catch {
    pagefind = undefined;
    status = 'Search is unavailable right now.';
  }
}

// Pagefind indexes writing/post.html; the site serves it as /writing/post.
const href = (url: string) => url.replace(/\.html$/, '');
</script>

<svelte:window onkeydown={onKeydown} />

{#if hydrated}
  <button type="button" onclick={open} aria-keyshortcuts="Control+K /">
    Search <kbd>Ctrl K</kbd>
  </button>
{:else}
  <a href="/writing">Browse writing</a>
{/if}

<dialog bind:this={dialog} aria-labelledby="search-title">
  <search>
    <h2 id="search-title">Search</h2>
    <label for="search-input">Search posts</label>
    <!-- svelte-ignore a11y_autofocus -->
    <input
      id="search-input"
      type="search"
      autocomplete="off"
      autofocus
      bind:value={query}
      oninput={search}
    >
    <button type="button" onclick={() => dialog?.close()}>Close</button>
  </search>
  <p role="status">{status}</p>
  <ul>
    {#each results as result (result.url)}
      <li>
        <a href={href(result.url)}>{result.meta.title ?? href(result.url)}</a>
        {#if result.filters.project?.length}
          <p class="search-projects">About {result.filters.project.join(', ')}</p>
        {/if}
        <!-- Pagefind escapes the excerpt and only adds <mark>. -->
        <p>{@html result.excerpt}</p>
      </li>
    {/each}
  </ul>
</dialog>
