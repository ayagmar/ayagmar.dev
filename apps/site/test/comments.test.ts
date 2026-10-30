import { describe, expect, it } from 'vitest';
import {
  commentTerm,
  discussionsHref,
  readMessage,
  themeFor,
  widgetUrl,
} from '../src/lib/comments.ts';

const frame = { name: 'the widget frame' };
const fromWidget = (data: unknown, origin = 'https://giscus.app', source: unknown = frame) =>
  readMessage({ origin, source, data }, frame);

describe('the widget URL', () => {
  const url = new URL(
    widgetUrl({
      page: 'https://ayagmar.dev/writing/token-logs#comments',
      term: commentTerm('writing', 'token-logs'),
      dark: true,
    })
  );

  // Catches the thread being keyed by anything but the collection and slug (title, path or URL),
  // which orphans it when a post is renamed or moved, and a loose match that adopts another thread.
  it('keys the thread by collection and slug, strictly', () => {
    expect(url.origin + url.pathname).toBe('https://giscus.app/en/widget');
    expect(url.searchParams.get('term')).toBe('writing/token-logs');
    expect(url.searchParams.get('strict')).toBe('1');
  });

  // Catches comments landing in another category or repository, or the owner's settings
  // (reactions on, input at the bottom, no metadata) drifting.
  it('points at the Comments category of this repository', () => {
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      repo: 'ayagmar/ayagmar.dev',
      repoId: 'R_kgDOVXWySQ',
      category: 'Comments',
      categoryId: 'DIC_kwDOVXWySc4DKCkk',
      reactionsEnabled: '1',
      emitMetadata: '0',
      inputPosition: 'bottom',
      theme: themeFor(true),
    });
  });
});

// Catches the no-JS link searching all of GitHub, or a slug character breaking the query.
it("links the page's discussion by exact title, in the Comments category", () => {
  const q = new URL(discussionsHref('til/a&b c')).searchParams.get('discussions_q');
  expect(q).toBe('category:Comments in:title "til/a&b c"');
  expect(discussionsHref('x')).toMatch(
    /^https:\/\/github\.com\/ayagmar\/ayagmar\.dev\/discussions\?/
  );
});

describe('messages from the widget', () => {
  it('reads a height', () => {
    expect(fromWidget({ giscus: { resizeHeight: 412.2 } })).toEqual({ height: 413 });
  });

  // Catches any page or frame that can post to the window resizing it or signing the reader out.
  it('ignores other origins, other frames and things that are not giscus messages', () => {
    const resize = { giscus: { resizeHeight: 900 } };
    expect(fromWidget(resize, 'https://giscus.app.evil.example')).toBeNull();
    expect(fromWidget(resize, 'https://evil.example')).toBeNull();
    expect(fromWidget(resize, 'https://giscus.app', { another: 'frame' })).toBeNull();
    for (const data of [null, 'resize', 42, [], {}, { giscus: null }, { giscus: 'tall' }]) {
      expect(fromWidget(data), JSON.stringify(data)).toBeNull();
    }
  });

  // Catches a malformed height collapsing the window, filling the page, or becoming NaN px.
  it('drops heights that are not a sane number', () => {
    for (const resizeHeight of ['tall', -5, 0, Number.NaN, Number.POSITIVE_INFINITY, null]) {
      expect(fromWidget({ giscus: { resizeHeight } }), String(resizeHeight)).toEqual({});
    }
    expect(fromWidget({ giscus: { resizeHeight: 1e9 } })).toEqual({ height: 20_000 });
  });

  // Catches a revoked or signed-out session being sent again on every load.
  it('asks to forget the sign-in on sign-out and on a rejected one, not on other errors', () => {
    expect(fromWidget({ giscus: { signOut: true } })).toEqual({ forgetSession: true });
    expect(fromWidget({ giscus: { error: 'Bad credentials' } })).toEqual({ forgetSession: true });
    expect(fromWidget({ giscus: { error: 'API rate limit exceeded' } })).toEqual({});
    expect(fromWidget({ giscus: { error: 7 } })).toEqual({});
  });
});
