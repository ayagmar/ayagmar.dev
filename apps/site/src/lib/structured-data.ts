/**
 * Structured data (schema.org JSON-LD) for search engines: what each page type states about
 * itself, built here and rendered once in the head by Base.astro. Every URL is production's,
 * like the canonical link, so a Preview describes the pages it will become.
 */
import type { About } from '../data/about.ts';
import { site, siteUrl } from './site.ts';
import { isoDay } from './writing.ts';

export type StructuredData = Record<string, unknown>;

const absolute = (path: string) => new URL(path, siteUrl).href;

const personId = `${siteUrl}/#person`;
const websiteId = `${siteUrl}/#website`;

/** The author, by reference: the full node is on home and /about. */
const author: StructuredData = {
  '@type': 'Person',
  '@id': personId,
  name: site.author,
  url: `${siteUrl}/`,
};

export function website(): StructuredData {
  return {
    '@type': 'WebSite',
    '@id': websiteId,
    url: `${siteUrl}/`,
    name: site.name,
    description: site.description,
    inLanguage: 'en',
    publisher: { '@id': personId },
  };
}

/** The owner, from content/about.json: every profile link but the site itself. */
export function person(identity: About['identity']): StructuredData {
  const { site: _own, ...profiles } = identity.links;
  return {
    '@type': 'Person',
    '@id': personId,
    name: identity.name,
    url: `${siteUrl}/`,
    jobTitle: identity.role,
    homeLocation: { '@type': 'Country', name: identity.location },
    sameAs: Object.values(profiles),
  };
}

/** /about: the profile page whose subject is the owner. */
export function profilePage(path: string): StructuredData {
  return {
    '@type': 'ProfilePage',
    url: absolute(path),
    mainEntity: { '@id': personId },
    isPartOf: { '@id': websiteId },
  };
}

export interface Article {
  path: string;
  title: string;
  description: string;
  published: Date;
  /** The last real change; the publication date when there is none. */
  modified?: Date | undefined;
  tags: readonly string[];
  /** Path of the link-preview image. */
  image: string;
}

/** A post or a TIL note. */
export function blogPosting(article: Article): StructuredData {
  const url = absolute(article.path);
  return {
    '@type': 'BlogPosting',
    '@id': `${url}#article`,
    headline: article.title,
    description: article.description,
    url,
    mainEntityOfPage: url,
    datePublished: isoDay(article.published),
    dateModified: isoDay(article.modified ?? article.published),
    author,
    publisher: { '@id': personId },
    image: absolute(article.image),
    ...(article.tags.length > 0 && { keywords: article.tags.join(', ') }),
    inLanguage: 'en',
    isPartOf: { '@id': websiteId },
  };
}

/** Home, then each parent down to the page itself (`path` of the last item is the page). */
export function breadcrumbs(trail: readonly { name: string; path: string }[]): StructuredData {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: [{ name: site.name, path: '/' }, ...trail].map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.name,
      item: absolute(crumb.path),
    })),
  };
}

/**
 * The nodes as one `<script type="application/ld+json">` body. `<` is escaped so no text in a
 * title or summary can close the element; JSON reads `\u003c` as `<`.
 */
export function jsonLd(nodes: readonly StructuredData[]): string {
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': nodes }).replaceAll(
    '<',
    '\\u003c'
  );
}
