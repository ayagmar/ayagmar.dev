// The rules of the W3C Feed Validation Service that need no network: the elements it requires,
// absolute URLs, RFC 822 and RFC 3339 dates, a self link and unique ids (ADR 0028). The
// browser's XML parser reads the feed, as it does for ADR 0021's well-formedness check.
import type { Page } from '@playwright/test';
import { expect } from './fixtures.ts';

const rfc822 = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/;
const rfc3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const absolute = /^https:\/\/ayagmar\.dev\//;
const tagUri = /^tag:ayagmar\.dev,\d{4}(-\d{2}-\d{2})?:\/\S+$/;

/** What a feed says, as the browser's XML parser reads it. */
interface FeedFacts {
  error: string | null;
  root: string;
  namespace: string | null;
  version: string | null;
  channels: number;
  /** Text of the feed's (or channel's) own required elements, by name. */
  head: Record<string, string[]>;
  selfLinks: string[];
  alternateLinks: string[];
  /** One record per item or entry. */
  entries: {
    id: string[];
    title: string[];
    link: string[];
    guid: string[];
    date: string[];
    updated: string[];
    description: string[];
    categories: string[];
  }[];
}

async function read(page: Page, source: string): Promise<FeedFacts> {
  await page.goto('/index.txt');
  return page.evaluate((text) => {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    const root = doc.documentElement;
    const kids = (el: Element, name: string) =>
      [...el.children].filter((c) => c.tagName === name).map((c) => c.textContent ?? '');
    const isAtom = root.localName === 'feed';
    const channel = isAtom ? root : root.querySelector('channel');
    const head: Record<string, string[]> = {};
    if (channel) {
      for (const name of [
        'id',
        'title',
        'link',
        'description',
        'subtitle',
        'updated',
        'lastBuildDate',
        'language',
      ]) {
        head[name] = kids(channel, name);
      }
      head.author = [...channel.children]
        .filter((c) => c.tagName === 'author')
        .map((c) => c.querySelector('name')?.textContent ?? '');
    }
    const links = channel
      ? [...channel.children].filter((c) => c.localName === 'link' && c.hasAttribute('href'))
      : [];
    const rel = (name: string) =>
      links
        .filter((l) => (l.getAttribute('rel') ?? 'alternate') === name)
        .map((l) => l.getAttribute('href') ?? '');
    const entries = [...doc.querySelectorAll(isAtom ? 'entry' : 'item')].map((entry) => ({
      id: kids(entry, 'id'),
      title: kids(entry, 'title'),
      link: isAtom
        ? [...entry.children]
            .filter((c) => c.tagName === 'link' && c.getAttribute('rel') === 'alternate')
            .map((c) => c.getAttribute('href') ?? '')
        : kids(entry, 'link'),
      guid: kids(entry, 'guid'),
      date: kids(entry, isAtom ? 'published' : 'pubDate'),
      updated: kids(entry, 'updated'),
      description: kids(entry, isAtom ? 'summary' : 'description'),
      categories: isAtom
        ? [...entry.children]
            .filter((c) => c.tagName === 'category')
            .map((c) => c.getAttribute('term') ?? '')
        : kids(entry, 'category'),
    }));
    return {
      error: doc.querySelector('parsererror')?.textContent ?? null,
      root: root.localName,
      namespace: root.namespaceURI,
      version: root.getAttribute('version'),
      channels: doc.querySelectorAll('channel').length,
      head,
      selfLinks: rel('self'),
      alternateLinks: rel('alternate'),
      entries,
    };
  }, source);
}

const valid = (date: string, format: RegExp) =>
  format.test(date) && !Number.isNaN(Date.parse(date));

/**
 * Checks the feed at `path` against the validator's offline rules and returns its entries' ids
 * (Atom) or links (RSS), newest first as written, so a test can compare them.
 */
export async function expectValidFeed(
  page: Page,
  request: { get(path: string): Promise<{ text(): Promise<string> }> },
  path: string,
  htmlPage: string
): Promise<string[]> {
  const feed = await read(page, await (await request.get(path)).text());
  const url = `https://ayagmar.dev${path}`;
  expect(feed.error).toBeNull();
  const atom = path.endsWith('atom.xml');
  expect(feed.root).toBe(atom ? 'feed' : 'rss');

  const text = (name: string) => feed.head[name] ?? [];
  expect(text('title').join()).not.toBe('');
  expect(feed.selfLinks).toEqual([url]);

  if (atom) {
    expect(feed.namespace).toBe('http://www.w3.org/2005/Atom');
    expect(text('id')).toHaveLength(1);
    expect(text('id')[0]).toMatch(tagUri);
    expect(text('updated')).toHaveLength(1);
    expect(valid(text('updated')[0] ?? '', rfc3339)).toBe(true);
    // Entries carry no author of their own, so the feed must.
    expect(text('author').join()).not.toBe('');
    expect(feed.alternateLinks).toEqual([`https://ayagmar.dev${htmlPage}`]);
  } else {
    expect(feed.version).toBe('2.0');
    expect(feed.channels).toBe(1);
    expect(text('link')).toEqual([`https://ayagmar.dev${htmlPage}`]);
    expect(text('description').join()).not.toBe('');
    expect(text('lastBuildDate')).toHaveLength(1);
    expect(valid(text('lastBuildDate')[0] ?? '', rfc822)).toBe(true);
  }

  const keys = atom
    ? feed.entries.map((e) => e.id[0] ?? '')
    : feed.entries.map((e) => e.link[0] ?? '');
  expect(new Set(keys).size, 'ids are unique').toBe(keys.length);
  for (const entry of feed.entries) {
    expect(entry.title.join()).not.toBe('');
    expect(entry.link).toHaveLength(1);
    expect(entry.link[0]).toMatch(absolute);
    expect(entry.date).toHaveLength(1);
    for (const category of entry.categories) expect(category).not.toBe('');
    if (atom) {
      expect(entry.id).toHaveLength(1);
      expect(entry.id[0]).toMatch(tagUri);
      expect(entry.updated).toHaveLength(1);
      expect(valid(entry.updated[0] ?? '', rfc3339)).toBe(true);
      expect(valid(entry.date[0] ?? '', rfc3339)).toBe(true);
    } else {
      expect(entry.guid).toEqual(entry.link);
      expect(valid(entry.date[0] ?? '', rfc822)).toBe(true);
      expect(entry.description.join()).not.toBe('');
    }
  }
  return keys;
}
