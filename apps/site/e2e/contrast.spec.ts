import { expect, test } from './fixtures.ts';

/** Contrast ratio of two `rgb()` strings as Chromium computes them. */
function contrast(a: string, b: string): number {
  const luminance = (color: string) => {
    const [r = 0, g = 0, b = 0] = (color.match(/[\d.]+/g) ?? []).slice(0, 3).map((v) => {
      const c = Number(v) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [hi = 0, lo = 0] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(colorScheme, () => {
    test.use({ colorScheme });

    // Catches the footer bar changing colour under a link without its focus ring following:
    // the lamp brown ring was 1.7:1 on the light theme's bar and axe does not check rings.
    test('a footer link shows a focus ring of at least 3:1 against the bar (WCAG 1.4.11)', async ({
      page,
    }) => {
      await page.goto('/');
      const link = page.locator('.site-footer a').first();
      await link.focus();
      const { ring, bar } = await link.evaluate((el) => ({
        ring: getComputedStyle(el).outlineColor,
        bar: getComputedStyle(el.closest('.site-footer') as Element).backgroundColor,
      }));
      expect(contrast(ring, bar)).toBeGreaterThanOrEqual(3);
    });

    // Catches a heat level fading back into the strip: a day with activity is a mark, and colour
    // is its only encoding. Each level must also stand apart from the one below it.
    test('every shipping heat level is at least 3:1 against the strip and steps from the last', async ({
      page,
    }) => {
      await page.goto('/stats');
      const { strip, levels } = await page.locator('.heat').evaluate((heat) => {
        const color = (level: number) => {
          const probe = document.createElement('i');
          probe.dataset.l = String(level);
          heat.querySelector('.heat-cells')?.append(probe);
          const value = getComputedStyle(probe).backgroundColor;
          probe.remove();
          return value;
        };
        return {
          strip: getComputedStyle(heat).backgroundColor,
          levels: [1, 2, 3, 4].map(color),
        };
      });
      for (const level of levels) expect(contrast(level, strip)).toBeGreaterThanOrEqual(3);
      for (const [i, level] of levels.slice(1).entries()) {
        expect(contrast(level, levels[i] as string)).toBeGreaterThanOrEqual(1.3);
      }
    });
  });
}
