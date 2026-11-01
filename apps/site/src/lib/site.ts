/** Facts about the site shown in pages, feeds and the plain-text view. */
export const siteUrl = 'https://ayagmar.dev';

export const site = {
  name: 'min7',
  /** The home page's title; every other page is `<its title> | min7`. */
  title: 'min7: Abdeslam Yassine Agmar, software engineer',
  author: 'Abdeslam Yassine Agmar',
  role: 'Software engineer',
  location: 'Morocco',
  email: 'hello@ayagmar.dev',
  description: 'Writing and projects by Abdeslam Yassine Agmar, a software engineer in Morocco.',
  links: {
    github: 'https://github.com/ayagmar',
    x: 'https://x.com/ayagmar_',
    lastfm: 'https://www.last.fm/user/min7_',
  },
} as const;

export const nav = [
  { href: '/writing', label: 'Writing' },
  { href: '/til', label: 'TIL' },
  { href: '/projects', label: 'Projects' },
  { href: '/skills', label: 'Skills' },
  { href: '/stats', label: 'Stats' },
  { href: '/about', label: 'About' },
] as const;

/**
 * Comments under posts and notes are GitHub Discussions in `repo`, category `category`, shown by
 * giscus (ADR 0036). The ids come from `https://giscus.app/api/discussions/categories?repo=<repo>`.
 */
export const comments = {
  origin: 'https://giscus.app',
  repo: 'ayagmar/ayagmar.dev',
  repoId: 'R_kgDOVXWySQ',
  category: 'Comments',
  categoryId: 'DIC_kwDOVXWySc4DKCkk',
} as const;

/** Linked from the footer and /about, not the header, which must stay one row at 320 px (ADR 0035). */
export const nowPage = { href: '/now', label: 'Now' } as const;

/** `mailto:` link for replying to a post or note: the subject is `Re: <title>`, RFC 6068 encoded. */
export const replyHref = (title: string) =>
  `mailto:${site.email}?subject=${encodeURIComponent(`Re: ${title}`)}`;

/** The public path of a built page: `/writing.html` and `/index.html` are served as `/writing` and `/`. */
export const publicPath = (pathname: string) =>
  pathname.replace(/\.html$/, '').replace(/(^|\/)index$/, '$1') || '/';
