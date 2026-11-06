/**
 * /stats as plain text (ADR 0040): the same panel markup the build and the browser draw
 * (src/lib/markup.ts), written out as lines. The text is built once, so every panel says when
 * its numbers are from, and the parts that need the reader's clock are left to the page.
 */
import {
  type Envelope,
  featuredProjects,
  type ListeningSnapshot,
  type LlmUsageSnapshot,
  type MonkeytypeSnapshot,
  type ProjectsSnapshot,
  type ShippingSnapshot,
} from '@min7/contracts';
import { rabatTime } from '../data/format.ts';
import { nowPlaying, nowPlayingMarkup } from './listening.ts';
import { listeningBody } from './listening-panel.ts';
import { freshnessWords } from './live.ts';
import { llmUsagePanel } from './llm-usage-panel.ts';
import type { Element, Markup } from './markup.ts';
import { site, siteUrl } from './site.ts';
import { statsWords as words } from './stats.ts';
import { projectsBody, shippingBody, typingBody } from './stats-panels.ts';
import { typingWords } from './typing.ts';

const lineTags = new Set(['p', 'h3', 'caption', 'figcaption', 'tr', 'li']);

/** One element's words on one line; two elements side by side get a gap, as the page's columns do. */
function inline(node: Markup): string {
  if (typeof node === 'string') return node;
  if (node.attrs['aria-hidden'] === 'true' || node.tag === 'summary') return '';
  if (node.attrs.role === 'img') return node.attrs['aria-label'] ?? '';
  if (node.tag === 'time' && 'data-ago' in node.attrs) return rabatTime(node.attrs.datetime ?? '');
  return node.children.reduce<{ text: string; after: boolean }>(
    ({ text, after }, child) => {
      const part = inline(child);
      if (part === '') return { text, after };
      const element = typeof child !== 'string';
      return { text: text + (after && element ? '  ' : '') + part, after: element };
    },
    { text: '', after: false }
  ).text;
}

const isElement = (node: Markup): node is Element => typeof node !== 'string';

/** `markup` as lines of text, list items numbered and indented, `dt` and `dd` on one line. */
function markupLines(nodes: readonly Markup[]): string[] {
  return nodes.filter(isElement).flatMap((node) => {
    if (node.attrs.role === 'img') return [`  ${inline(node)}`];
    if (node.tag === 'ol' || node.tag === 'ul') {
      const start = Number(node.attrs.start ?? 1);
      return node.children
        .filter(isElement)
        .map((item, index) =>
          node.tag === 'ol' ? `  ${start + index}. ${inline(item)}` : `  ${inline(item)}`
        );
    }
    const term = node.children.filter(isElement).find((child) => child.tag === 'dt');
    if (term !== undefined) {
      const definition = node.children.filter(isElement).find((child) => child.tag === 'dd');
      return [`  ${inline(term)}: ${definition === undefined ? '' : inline(definition)}`];
    }
    if (lineTags.has(node.tag)) {
      const line = inline(node).trim();
      return line === '' ? [] : [line];
    }
    return markupLines(node.children);
  });
}

export interface StatsSources {
  listening: Envelope<ListeningSnapshot, 'listening'>;
  projects: Envelope<ProjectsSnapshot, 'projects'>;
  typing: Envelope<MonkeytypeSnapshot, 'monkeytype'>;
  shipping: Envelope<ShippingSnapshot, 'shipping'>;
  llmUsage: Envelope<LlmUsageSnapshot, 'llm-usage'>;
}

/** When a panel's numbers are from, as the page's line says it; fixtures are never live. */
function freshness(envelope: Envelope<unknown>, sample: boolean): string[] {
  if (envelope.data === null || envelope.fetchedAt === null) return [];
  return sample
    ? ['Sample data, not live']
    : [`${freshnessWords(!envelope.stale)}${rabatTime(envelope.fetchedAt)} (Rabat time)`];
}

/** What `curl ayagmar.dev/stats` prints: each panel's numbers as of the build. */
export function renderStatsText(sources: StatsSources, sample: boolean): string {
  const { listening, projects, typing, shipping, llmUsage } = sources;
  const rule = '-'.repeat(72);
  const featured = featuredProjects.map((project) => project.repo);
  const played =
    listening.data === null || listening.fetchedAt === null
      ? null
      : nowPlayingMarkup(nowPlaying(listening.data, listening.fetchedAt, false));
  const panels: [title: string, lines: string[], envelope: Envelope<unknown>][] = [
    [
      'Listening',
      listening.data === null
        ? [words.noListening]
        : markupLines([
            {
              tag: 'p',
              attrs: {},
              children: [...(played?.words ?? []), ' ', ...(played?.at ? [played.at] : [])],
            },
            ...listeningBody(listening.data),
          ]),
      listening,
    ],
    [
      'Projects',
      projects.data === null ? [words.noProjects] : markupLines(projectsBody(projects.data)),
      projects,
    ],
    [
      'Typing',
      typing.data === null ? [typingWords.noData] : markupLines(typingBody(typing.data)),
      typing,
    ],
    [
      'Shipping',
      shipping.data === null
        ? [words.noShipping]
        : markupLines(shippingBody(shipping.data, featured)),
      shipping,
    ],
    [
      'LLM usage',
      llmUsage.data === null || llmUsage.fetchedAt === null
        ? [words.noLlmUsage]
        : markupLines(llmUsagePanel(llmUsage.data, llmUsage.fetchedAt)),
      llmUsage,
    ],
  ];
  return [
    `Stats | ${site.name}`,
    sample ? words.sample : words.snapshot,
    rule,
    ...panels.flatMap(([title, lines, envelope]) => [
      title,
      ...lines,
      ...freshness(envelope, sample),
      rule,
    ]),
    `  ${'Page'.padEnd(10)} ${siteUrl}/stats`,
    `  ${'Home'.padEnd(10)} ${siteUrl}`,
    '',
  ].join('\n');
}
