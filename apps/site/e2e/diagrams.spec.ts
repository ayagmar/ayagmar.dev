import { expect, test } from './fixtures.ts';

// The placeholder draft with a flowchart and a chart, so these tests run on the drafts build.
const post = '/writing/token-logs';
const chart = 'Placeholder numbers: cache reads per agent, in millions of tokens';
const diagrams = [{ name: 'From session log to token totals' }, { name: chart }];

for (const width of [320, 360, 1280]) {
  // Catches diagrams that are missing, unnamed, or wider than a phone screen.
  test(`diagrams show and fit at ${width}px`, { tag: '@drafts' }, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(post);
    for (const { name } of diagrams) {
      const svg = page.getByRole('img', { name });
      await expect(svg).toBeVisible();
      const box = await svg.boundingBox();
      expect(box?.width).toBeGreaterThan(100);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

// Catches diagrams that bring their own JavaScript or style attributes the CSP would block, and
// a stylesheet that misses the classes a page uses.
test('diagrams add no script, no inline style and are fully styled by /diagrams.css', {
  tag: '@drafts',
}, async ({ page, request }) => {
  const html = await (await request.get(post)).text();
  expect(html).not.toMatch(/\sstyle=/);

  const scripts = (path: string) =>
    page
      .goto(path)
      .then(() => page.locator('script').evaluateAll((all) => all.map((s) => s.outerHTML).sort()));
  // Same scripts as a page without diagrams: Astro's search island and the click handler of the
  // comments window (ADR 0036) a post carries and /about does not.
  const comments = /Comments\.astro_astro_type_script/;
  const withoutComments = async (path: string) =>
    (await scripts(path)).filter((script) => !comments.test(script));
  expect(await withoutComments(post)).toEqual(await scripts('/about'));

  const css = await request.get('/diagrams.css');
  expect(css.headers()['content-type']).toContain('text/css');
  const rules = await css.text();
  const used = new Set([...html.matchAll(/\bpele-s-[0-9a-f]+/g)].map(([name]) => name));
  expect(used.size).toBeGreaterThan(0);
  for (const name of used) expect(rules).toContain(`.${name}{`);
});

// Catches a chart drawn in Pele's default blue, which ignores the theme and the paper.
for (const [colorScheme, accent] of [
  ['light', 'rgb(47, 109, 90)'],
  ['dark', 'rgb(138, 44, 38)'],
] as const) {
  test(`chart bars take the paper's accent in the ${colorScheme} theme`, {
    tag: '@drafts',
  }, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto(post);
    const fill = await page
      .getByRole('img', { name: chart })
      .locator('.pele-bars rect')
      .first()
      .evaluate((bar) => getComputedStyle(bar).fill);
    expect(fill).toBe(accent);
  });
}
