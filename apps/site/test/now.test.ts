import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import Brewing from '../src/components/Brewing.astro';
import { isStale, staleAfterDays } from '../src/lib/now.ts';
import { type BrewingItem, nowSchema } from '../src/lib/now-schema.ts';
import { replyHref, site } from '../src/lib/site.ts';

const built = new Date('2026-10-30T12:00:00Z');
const valid = {
  updated: new Date('2026-10-30'),
  brewing: [
    { name: 'runnerd', note: 'Ephemeral runners.', url: 'https://github.com/ayagmar/runnerd' },
  ],
};

/** The field and message Astro prints next to the file name when a build fails. */
function problems(frontmatter: Record<string, unknown>) {
  const result = nowSchema(built).safeParse(frontmatter);
  return result.success
    ? []
    : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
}

describe('now frontmatter', () => {
  it('accepts today and an empty or missing list', () => {
    expect(problems(valid)).toEqual([]);
    expect(nowSchema(built).parse({ updated: valid.updated }).brewing).toEqual([]);
  });

  // Catches a typo such as 2062-10-30 making the page look permanently fresh.
  it.each([
    ['a future day', { updated: new Date('2026-10-31') }, 'updated: must not be in the future'],
    ['a missing day', { updated: undefined }, expect.stringMatching(/^updated: /)],
    [
      'an http url',
      { brewing: [{ name: 'a', note: 'b', url: 'http://example.com' }] },
      'brewing.0.url: must be an https:// URL',
    ],
    [
      'a script url',
      { brewing: [{ name: 'a', note: 'b', url: 'javascript:alert(1)' }] },
      'brewing.0.url: must be an https:// URL',
    ],
    [
      'an empty name',
      { brewing: [{ name: '  ', note: 'b' }] },
      'brewing.0.name: must not be empty',
    ],
    ['a missing note', { brewing: [{ name: 'a' }] }, expect.stringMatching(/^brewing\.0\.note: /)],
    [
      'an unknown item field',
      { brewing: [{ name: 'a', note: 'b', link: 'https://example.com' }] },
      expect.stringMatching(/^brewing\.0: /),
    ],
  ])('rejects %s', (_case, change, message) => {
    expect(problems({ ...valid, ...change })).toEqual([message]);
  });
});

describe('staleness', () => {
  const updated = '2026-10-30';
  const at = (days: number) => Date.parse(updated) + days * 24 * 60 * 60 * 1000;

  // Catches an off-by-one on the 90-day line, and a page that never goes stale.
  it('begins after 90 days', () => {
    expect(isStale(updated, at(staleAfterDays))).toBe(false);
    expect(isStale(updated, at(staleAfterDays) + 1)).toBe(true);
  });
});

describe('the brewing window', () => {
  const render = (items: BrewingItem[]) =>
    AstroContainer.create().then((container) =>
      container.renderToString(Brewing, { props: { items } })
    );

  // Catches an empty "Currently brewing" window being drawn for an empty list.
  it('is not drawn for an empty list', async () => {
    expect((await render([])).trim()).toBe('');
  });

  it('links an item that has a url and leaves one without as text', async () => {
    const html = await render([
      { name: 'linked', note: 'n', url: 'https://example.com/a' },
      { name: 'plain', note: 'n' },
    ]);
    expect(html).toContain('<a href="https://example.com/a">linked</a>');
    expect(html).toMatch(/<strong>plain<\/strong>/);
  });
});

describe('reply by email', () => {
  const titles = [
    'Plain title',
    'Fish & chips',
    'Issue #42',
    'Why? Because',
    '100% cached',
    'He said "no" and \'maybe\'',
    'Café, naïve, 日本語, 🚀',
    'a+b = c',
    `${'A very long title '.repeat(30)}end`,
  ];

  // Catches a title character such as & or # ending the subject early, a + read as a space,
  // and non-ASCII being mangled: the decoded subject must be the title, exactly.
  it.each(titles)('round-trips the subject for %s', (title) => {
    const href = replyHref(title);
    expect(href.startsWith(`mailto:${site.email}?subject=`)).toBe(true);
    expect(href).not.toMatch(/[ +]/);
    const url = new URL(href);
    expect(url.pathname).toBe(site.email);
    expect([...url.searchParams.keys()]).toEqual(['subject']);
    // URLSearchParams reads + as a space, so check with the strict decoder RFC 6068 uses.
    expect(decodeURIComponent(href.slice(href.indexOf('subject=') + 8))).toBe(`Re: ${title}`);
  });
});
