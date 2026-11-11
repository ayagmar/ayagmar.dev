/**
 * /stats as plain text (ADR 0040): the same panel markup the build and the browser draw
 * (src/lib/markup.ts), written out as lines. The text is built once, so every panel says when
 * its numbers are from, and the parts that need the reader's clock are left to the page.
 */
import {
  type Envelope,
  type ListeningSnapshot,
  type LlmUsageSnapshot,
  type MonkeytypeSnapshot,
  type ProjectsSnapshot,
  pulledProjects,
  type ShippingSnapshot,
} from '@min7/contracts';
import { nowPlaying, nowPlayingMarkup } from './listening.ts';
import { listeningBody } from './listening-panel.ts';
import { freshnessWords } from './live.ts';
import { llmUsagePanel } from './llm-usage-panel.ts';
import { markupLines } from './markup-text.ts';
import { sampleNote, site, siteUrl, textRule } from './site.ts';
import { statsBuildWords, statsWords as words } from './stats.ts';
import { projectsBody, shippingBody, typingBody } from './stats-panels.ts';
import { typingWords } from './typing.ts';
import { rabatStamp } from './words.ts';

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
    ? [sampleNote]
    : [`${freshnessWords(!envelope.stale)}${rabatStamp(envelope.fetchedAt)} (Rabat time)`];
}

/** What `curl ayagmar.dev/stats` prints: each panel's numbers as of the build. */
export function renderStatsText(sources: StatsSources, sample: boolean): string {
  const { listening, projects, typing, shipping, llmUsage } = sources;
  const featured = pulledProjects.map((project) => project.repo);
  const played =
    listening.data === null || listening.fetchedAt === null
      ? null
      : nowPlayingMarkup(nowPlaying(listening.data, listening.fetchedAt, false));
  const panels: [title: string, lines: string[], envelope: Envelope<unknown>][] = [
    [
      'Listening',
      listening.data === null
        ? [statsBuildWords.noListening]
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
        ? [statsBuildWords.noLlmUsage]
        : markupLines(llmUsagePanel(llmUsage.data, llmUsage.fetchedAt)),
      llmUsage,
    ],
  ];
  return [
    `Stats | ${site.name}`,
    sample ? statsBuildWords.sample : statsBuildWords.snapshot,
    textRule,
    ...panels.flatMap(([title, lines, envelope]) => [
      title,
      ...lines,
      ...freshness(envelope, sample),
      textRule,
    ]),
    `  ${'Page'.padEnd(10)} ${siteUrl}/stats`,
    `  ${'Home'.padEnd(10)} ${siteUrl}`,
    '',
  ].join('\n');
}
