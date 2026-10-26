/** Facts about the site shown in pages, feeds and the plain-text view. */
export const siteUrl = 'https://ayagmar.dev';

export const site = {
  name: 'min7',
  author: 'Abdeslam Yassine Agmar',
  role: 'Software engineer',
  location: 'Morocco',
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

/** The public path of a built page: `/writing.html` and `/index.html` are served as `/writing` and `/`. */
export const publicPath = (pathname: string) =>
  pathname.replace(/\.html$/, '').replace(/(^|\/)index$/, '$1') || '/';
