import type { TilFrontmatter } from './til-schema.ts';

/** A TIL note as every renderer sees it; `id` is the file name without `.md`, `body` its Markdown. */
export interface Note {
  id: string;
  data: TilFrontmatter;
  body?: string | undefined;
}

export const notePath = (id: string) => `/til/${id}`;

const summaryLength = 200;

/**
 * The note's first paragraph as plain text, for feeds and the page description; the title when the
 * note starts with code. Cut at a word, with an ellipsis, past 200 characters.
 */
export function noteSummary(note: Note): string {
  const paragraph = (note.body ?? '')
    .replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\1[ \t]*$/gm, '')
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .find((block) => block !== '' && !/^(#|>|[-*+] |\d+\. |\||<)/.test(block));
  const text = (paragraph ?? '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text === '') return note.data.title;
  if (text.length <= summaryLength) return text;
  return `${text.slice(0, summaryLength).replace(/\s+\S*$/, '')}…`;
}
