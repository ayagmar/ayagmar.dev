import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { buildOrigin } from '../src/lib/og.ts';
import { renderOgCard } from '../src/lib/og-card.ts';

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
});
