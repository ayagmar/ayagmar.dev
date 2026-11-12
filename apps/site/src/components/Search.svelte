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

interface Link {
  href: string;
  label: string;
}

/**
 * `browse`: the link shown until the island hydrates or without scripts (`browseLink` in
 * writing.ts). `fallback`: the pages offered when a search finds nothing (`searchFallback`).
 */
const { browse, fallback }: { browse: Link; fallback: readonly Link[] } = $props();

let hydrated = $state(false);
let dialog = $state<HTMLDialogElement>();
let query = $state('');
let results = $state<Result[]>([]);
let status = $state('');
// The search that found nothing, said back with the pages to try; null otherwise.
let nothingFor = $state<string | null>(null);
let pagefind: Promise<Pagefind> | undefined;
// Counts inputs, clearing the field included. A search whose number is no longer the latest
// leaves the dialog alone, whether it answers or fails: the field has changed under it.
let latest = 0;

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
    // `/` is a single-key shortcut: off with the list of keys' switch (theme.js, ADR 0027), and
    // left to the browser with a modifier (Ctrl / and the like). AltGr, which Windows reports as
    // Ctrl+Alt, is how some layouts type `/` at all.
    (event.key === '/' &&
      (event.getModifierState('AltGraph') || !(event.ctrlKey || event.altKey || event.metaKey)) &&
      !isTyping(event.target) &&
      !document.documentElement.dataset.shortcuts);
  if (!shortcut || dialog?.open) return;
  event.preventDefault();
  open();
}

async function search() {
  const input = ++latest;
  const term = query.trim();
  if (term === '') {
    results = [];
    status = '';
    nothingFor = null;
    return;
  }
  pagefind ??= import(/* @vite-ignore */ bundle);
  try {
    const found = await (await pagefind).debouncedSearch(term);
    if (found === null || input !== latest) return;
    const data = await Promise.all(found.results.slice(0, limit).map((result) => result.data()));
    if (input !== latest) return;
    results = data;
    nothingFor = results.length === 0 ? term : null;
    status = `${results.length} ${results.length === 1 ? 'result' : 'results'}.`;
  } catch {
    pagefind = undefined;
    if (input !== latest) return;
    nothingFor = null;
    status = 'Search is unavailable right now.';
  }
}

// Svelte keeps a space where the markup breaks a line, so the words around each link come from
// here: "Try Projects, About or Stats."
const separator = (index: number) =>
  index === 0 ? '' : index === fallback.length - 1 ? ' or ' : ', ';
const end = (index: number) => (index === fallback.length - 1 ? '.' : '');

// A native search field takes the first Escape to clear itself; one Escape closes the dialog.
// While an input method is composing, Escape cancels the composition and is left to it.
function onFieldKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || event.isComposing) return;
  event.preventDefault();
  dialog?.close();
}

// Any `[data-search-open]` on the page opens the dialog, such as the 404's "Search".
function onClick(event: MouseEvent) {
  if (!(event.target instanceof Element) || !event.target.closest('[data-search-open]')) return;
  open();
}

// Pagefind indexes writing/post.html; the site serves it as /writing/post.
const href = (url: string) => url.replace(/\.html$/, '');
</script>

<svelte:window onkeydown={onKeydown} />
<svelte:document onclick={onClick} />

{#if hydrated}
  <!-- The hint names `/`, or Ctrl K when single-key shortcuts are off (base.css). Only Ctrl K is
       announced: it works whatever the switch says; the list of keys gives `/`. -->
  <button type="button" onclick={open} aria-keyshortcuts="Control+K">
    Search <kbd>/</kbd><kbd>Ctrl K</kbd>
  </button>
{:else}
  <!-- With scripts on, base.css shows only the second span, the button's face (ADR 0042). -->
  <a href={browse.href}>
    <span class="search-no-script">{browse.label}</span>
    <span class="search-script">Search <kbd>/</kbd><kbd>Ctrl K</kbd></span>
  </a>
{/if}

<dialog bind:this={dialog} aria-labelledby="search-title">
  <search>
    <h2 id="search-title">Search</h2>
    <label for="search-input">Search the site</label>
    <!-- svelte-ignore a11y_autofocus -->
    <input
      id="search-input"
      type="search"
      autocomplete="off"
      autofocus
      bind:value={query}
      oninput={search}
      onkeydown={onFieldKeydown}
    >
    <button type="button" onclick={() => dialog?.close()}>Close</button>
  </search>
  <p role="status">
    {#if nothingFor !== null}
      Nothing for "{nothingFor}". Try
      {#each fallback as page, index (page.href)}
        {separator(index)}<a href={page.href}>{page.label}</a>{end(index)}
      {/each}
    {:else}
      {status}
    {/if}
  </p>
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
