// Comments under posts and notes (ADR 0036): the giscus widget URL, its messages and the theme
// it follows, as plain functions so the browser script and the tests share them.
import { comments } from './site.ts';

/** giscus themes that sit with the day and night palettes (ADR 0034). */
const themes = { light: 'noborder_light', dark: 'noborder_dark' } as const;

export const themeFor = (dark: boolean) => (dark ? themes.dark : themes.light);

/**
 * The discussion's title: the collection and slug, not the title or the path, so renaming a
 * post or moving its page does not orphan its thread.
 */
export const commentTerm = (collection: 'writing' | 'til', slug: string) => `${collection}/${slug}`;

/** The discussions of one page on GitHub, for readers without JavaScript. */
export const discussionsHref = (term: string) =>
  `https://github.com/${comments.repo}/discussions?discussions_q=${encodeURIComponent(
    `category:${comments.category} in:title "${term}"`
  )}`;

interface WidgetOptions {
  /** The page showing the widget, without a hash or giscus's own `?giscus=` parameter. */
  page: string;
  term: string;
  dark: boolean;
  /** The reader's stored GitHub sign-in, if any. */
  session?: string | null;
}

/** The iframe URL, built from the parameters giscus's own `client.js` sends. */
export function widgetUrl({ page, term, dark, session }: WidgetOptions): string {
  const params = new URLSearchParams({
    origin: page,
    session: session ?? '',
    theme: themeFor(dark),
    reactionsEnabled: '1',
    emitMetadata: '0',
    inputPosition: 'bottom',
    repo: comments.repo,
    repoId: comments.repoId,
    category: comments.category,
    categoryId: comments.categoryId,
    strict: '1',
    description: '',
    backLink: page,
    term,
  });
  return `${comments.origin}/en/widget?${params}`;
}

/** What the widget asked of the page. */
export interface WidgetMessage {
  height?: number;
  /** The reader signed out, or the stored sign-in no longer works. */
  forgetSession?: boolean;
}

/** A thread this tall is a bug in the widget, not a conversation. */
const maxHeight = 20_000;

const staleSession = ['Bad credentials', 'Invalid state value', 'State has expired'];

/**
 * Reads a `message` event from the widget's frame. Anything that is not from giscus's origin, not
 * from `frame`, or not shaped like its messages is `null`.
 */
export function readMessage(
  event: { origin: string; source: unknown; data: unknown },
  frame: unknown
): WidgetMessage | null {
  if (event.origin !== comments.origin || event.source !== frame) return null;
  const data = event.data;
  if (typeof data !== 'object' || data === null || !('giscus' in data)) return null;
  const message = data.giscus;
  if (typeof message !== 'object' || message === null) return null;
  const result: WidgetMessage = {};
  if ('resizeHeight' in message) {
    const height = message.resizeHeight;
    if (typeof height === 'number' && Number.isFinite(height) && height > 0) {
      result.height = Math.min(Math.ceil(height), maxHeight);
    }
  }
  if ('signOut' in message && message.signOut) result.forgetSession = true;
  if ('error' in message && typeof message.error === 'string') {
    if (staleSession.some((text) => (message.error as string).includes(text))) {
      result.forgetSession = true;
    }
  }
  return result;
}
