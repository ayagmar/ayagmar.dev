import { join } from 'node:path';
import type { ShippingActivityDay } from '@min7/contracts';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { renderArt } from '../src/lib/art-files.ts';
import { buildOrigin, yearOgImage } from '../src/lib/og.ts';
import { renderOgCard, renderYearCard } from '../src/lib/og-card.ts';
import { type YearPage, yearPages } from '../src/lib/years.ts';

describe('link-preview origin', () => {
  it('is production for main and for builds outside Workers Builds', () => {
    expect(buildOrigin(undefined)).toBe('https://ayagmar.dev');
    expect(buildOrigin('')).toBe('https://ayagmar.dev');
    expect(buildOrigin('main')).toBe('https://ayagmar.dev');
  });

  // Branches whose Previews Cloudflare made (their links on pull requests #93 and #94).
  it.each([
    ['feat/icons-and-og', 'https://feat-icons-and-og-min7-site.ayagmar.workers.dev'],
    ['renovate/renovate-44.x', 'https://renovate-renovate-44-x-min7-site.ayagmar.workers.dev'],
  ])("is the Preview's URL for %s", (branch, origin) => {
    expect(buildOrigin(branch)).toBe(origin);
  });

  it('is production when the Preview name cannot be one DNS label', () => {
    expect(buildOrigin(`feat/${'a'.repeat(60)}`)).toBe('https://ayagmar.dev');
  });
});

describe('link-preview card', () => {
  /** Whether every pixel of a rectangle of the card is the ground of its top-left corner. */
  async function blank(
    png: Buffer,
    area: { left: number; top: number; width: number; height: number }
  ) {
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    const at = (x: number, y: number) => (y * info.width + x) * info.channels;
    const ground = data.subarray(0, info.channels);
    for (let y = area.top; y < area.top + area.height; y++) {
      for (let x = area.left; x < area.left + area.width; x++) {
        if (!data.subarray(at(x, y), at(x, y) + info.channels).equals(ground)) return false;
      }
    }
    return true;
  }

  // Titles the schemas accept that once threw (wider than the card) or ran off its bottom.
  it.each([
    'How to configure OpenTelemetryCollectorSpanExporterConfigurationBuilder',
    `The release digest ${'3f9a0c7be1d24e56'.repeat(4)} matched`,
    'A detailed explanation of caching, serialization, compression, concurrency, and replay protection in the delivery pipeline: lessons from building a reliable self-hosted Worker on a home machine',
  ])('keeps the title inside its margins: %s', async (title) => {
    const png = await renderOgCard({ title, line: 'min7 · Writing' });
    expect(await sharp(png).metadata()).toMatchObject({ width: 1200, height: 630 });
    // The 120 px right margin and the 40 px under the text box stay empty.
    expect(await blank(png, { left: 1080, top: 0, width: 120, height: 630 })).toBe(true);
    expect(await blank(png, { left: 0, top: 590, width: 1200, height: 40 })).toBe(true);
  });

  /** A region of the card's picture, as raw RGB. */
  const pictureRegion = (png: Buffer) =>
    sharp(png)
      .extract({
        left: 120 + region.left,
        top: 56 + region.top,
        width: region.width,
        height: region.height,
      })
      .removeAlpha()
      .raw()
      .toBuffer();
  // The lamp, the window and the monitor: a part of the room with many colours in it.
  const region = { left: 60, top: 20, width: 500, height: 200 };

  // Catches art lost on the way through librsvg (a dash pattern it draws as nothing), or the
  // night plate dropped from the card.
  it('draws the night art on a post with art', async () => {
    const png = await renderOgCard({
      title: 'A post',
      line: 'min7 · Writing',
      art: renderArt('notebook'),
    });
    const data = await pictureRegion(png);
    let cream = 0;
    for (let at = 0; at < data.length; at += 3) {
      if (Math.abs((data[at] ?? 0) - 240) + Math.abs((data[at + 2] ?? 0) - 200) < 24) cream++;
    }
    expect(cream).toBeGreaterThan(200);
    expect([...data.subarray(0, 3)]).toEqual([13, 15, 30]);
  });

  // Catches a blank or wrong picture on a post without art: the card must show the night room.
  it('draws the night room on a post without art', async () => {
    const card = await pictureRegion(
      await renderOgCard({ title: 'A post', line: 'min7 · Writing' })
    );
    const room = await sharp(join(import.meta.dirname, '../src/assets/room-night.png'))
      .resize(960, 320, { kernel: 'nearest' })
      .extract(region)
      .removeAlpha()
      .raw()
      .toBuffer();
    const blank = Buffer.alloc(room.length, card.subarray(0, 3));
    const distance = (a: Buffer, b: Buffer) =>
      a.reduce((sum, value, at) => sum + Math.abs(value - (b[at] ?? 0)), 0) / a.length;
    // The card is a palette PNG, so its colours land near the room's, not on them.
    expect(distance(card, room)).toBeLessThan(6);
    expect(distance(room, blank)).toBeGreaterThan(20);
  });
});

describe('year card', () => {
  const day = (date: string, pushes: number, merges = 0): ShippingActivityDay => ({
    date,
    pushes,
    commits: pushes,
    merges,
    releases: 0,
    stars: 0,
    repos: [],
    reposComplete: true,
  });
  const year = (shipping: ShippingActivityDay[], now: string, failed: string[] = []): YearPage => {
    const fetchedAt = '2026-10-20T09:00:00Z';
    const [page] = yearPages(
      {
        shipping: { days: shipping, failed, fetchedAt },
        usage: { days: [], failed: [], fetchedAt },
      },
      [],
      new Date(now),
      new Set()
    );
    if (page === undefined) throw new Error('no year page');
    return page;
  };

  // Catches a fixtures build, whose history stops in October, drawing a new card every day it is
  // built: days without a record would add squares and the image would never be the same twice.
  it('is the same image whatever day it is built', async () => {
    const days = [day('2026-10-01', 3, 1), day('2026-10-02', 0), day('2026-10-20', 1)];
    const early = await renderYearCard(year(days, '2026-10-21T12:00:00Z'));
    const late = await renderYearCard(year(days, '2026-12-30T12:00:00Z'));
    expect(early.equals(late)).toBe(true);
  });

  // Catches squares in the wrong week or weekday. 1 Jan 2024 is a Monday, so the first column
  // starts on it, and 31 Dec 2024, a Tuesday, is the second row of column 52.
  it("draws a day in its week's column and its weekday's row", async () => {
    const png = await renderYearCard(
      year([day('2024-01-01', 2), day('2024-12-31', 2)], '2025-06-01T12:00:00Z')
    );
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number) => {
      const at = (y * info.width + x) * info.channels;
      return [...data.subarray(at, at + 3)];
    };
    // The middle of a 14 px square on a 17 px pitch, the calendar 256 px down.
    const square = (column: number, row: number) =>
      pixel(120 + column * 17 + 7, 256 + row * 17 + 7);
    const ground = [14, 12, 19];
    expect(square(0, 0)).not.toEqual(ground);
    expect(square(52, 1)).not.toEqual(ground);
    expect(square(0, 1)).toEqual(ground);
    expect(square(52, 0)).toEqual(ground);
  });

  // Catches a text alternative claiming what the card leaves out: an unread month drawn as quiet,
  // or a figure the card does not show.
  it('says what the card draws and leaves blank', () => {
    const page = year(
      [day('2026-03-02', 1), day('2026-03-03', 2, 1), day('2026-05-04', 1)],
      '2026-06-10T12:00:00Z',
      ['2026-04']
    );
    expect(yearOgImage(page)).toEqual({
      path: '/og/year/2026.png',
      alt: '2026 on min7: a square for each day with shipping on record, 2 Mar to 4 May, April blank as unread.',
    });
    expect(
      yearOgImage(year([day('2026-03-02', 1), day('2026-03-03', 2, 1)], '2026-06-10T12:00:00Z')).alt
    ).toBe(
      '2026 on min7: a square for each day with shipping on record, 2 Mar to 3 Mar; 1 PR merged on record so far and 2 days with something shipped on record so far.'
    );
  });
});
