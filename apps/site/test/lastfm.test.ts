import { describe, expect, it } from 'vitest';
import { artistUrl, trackUrl } from '../src/lib/lastfm.ts';

// Catches a link that misses the page: each expected URL is the one Last.fm's own pages link
// to (www.last.fm, 2026-10-31).
describe('Last.fm links built from names', () => {
  it.each([
    ['Simon & Garfunkel', 'https://www.last.fm/music/Simon+&+Garfunkel'],
    ['AC/DC', 'https://www.last.fm/music/AC%2FDC'],
    ['Florence + the Machine', 'https://www.last.fm/music/Florence+%252B+the+Machine'],
    ['Sigur Rós', 'https://www.last.fm/music/Sigur+R%C3%B3s'],
    ['坂本龍一', 'https://www.last.fm/music/%E5%9D%82%E6%9C%AC%E9%BE%8D%E4%B8%80'],
  ])('%s', (artist, url) => {
    expect(artistUrl(artist)).toBe(url);
  });

  it.each([
    ['Weezer', 'Why Bother?', 'https://www.last.fm/music/Weezer/_/Why+Bother%3F'],
    [
      'Sigur Rós',
      'Untitled #9 - Smáskifa 1',
      'https://www.last.fm/music/Sigur+R%C3%B3s/_/Untitled+%239+-+Sm%C3%A1skifa+1',
    ],
    [
      'Weezer',
      'Undone (The Sweater Song)',
      'https://www.last.fm/music/Weezer/_/Undone+(The+Sweater+Song)',
    ],
    [
      'Simon & Garfunkel',
      'Scarborough Fair / Canticle',
      'https://www.last.fm/music/Simon+&+Garfunkel/_/Scarborough+Fair+%2F+Canticle',
    ],
    [
      'AC/DC',
      "It's a Long Way to the Top",
      'https://www.last.fm/music/AC%2FDC/_/It%27s+a+Long+Way+to+the+Top',
    ],
    [
      'Simon & Garfunkel',
      'Mrs. Robinson - From "The Graduate" Soundtrack',
      'https://www.last.fm/music/Simon+&+Garfunkel/_/Mrs.+Robinson+-+From+%22The+Graduate%22+Soundtrack',
    ],
  ])('%s, %s', (artist, track, url) => {
    expect(trackUrl(artist, track)).toBe(url);
  });

  // Catches a name that leaves the artist's path: the page stays on Last.fm, under /music/.
  it('keeps any name inside the path', () => {
    const url = new URL(trackUrl('a/../../evil?x=1#y', '../..'));
    expect(url.origin).toBe('https://www.last.fm');
    expect(url.pathname).toMatch(/^\/music\/[^/]+\/_\/[^/]+$/);
    expect(url.search + url.hash).toBe('');
  });
});
