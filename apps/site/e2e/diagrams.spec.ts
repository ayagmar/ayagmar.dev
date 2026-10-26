import { expect, test } from './fixtures.ts';

// The placeholder post with a flowchart and a chart.
const post = '/writing/token-logs';
const diagrams = [
  { name: 'From session log to token totals' },
  { name: 'Placeholder numbers: cache reads per agent, in millions of tokens' },
];

for (const width of [320, 360, 1280]) {
  // Catches diagrams that are missing, unnamed, or wider than a phone screen.
  test(`diagrams show and fit at ${width}px`, async ({ page }) => {
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
test('diagrams add no script, no inline style and are fully styled by /diagrams.css', async ({
  page,
  request,
}) => {
  const html = await (await request.get(post)).text();
  expect(html).not.toMatch(/\sstyle=/);

  const scripts = (path: string) =>
    page
      .goto(path)
      .then(() => page.locator('script').evaluateAll((all) => all.map((s) => s.outerHTML).sort()));
  // Same scripts as a page without diagrams: Astro's search island and nothing else.
  expect(await scripts(post)).toEqual(await scripts('/about'));

  const css = await request.get('/diagrams.css');
  expect(css.headers()['content-type']).toContain('text/css');
  const rules = await css.text();
  const used = new Set([...html.matchAll(/\bpele-s-[0-9a-f]+/g)].map(([name]) => name));
  expect(used.size).toBeGreaterThan(0);
  for (const name of used) expect(rules).toContain(`.${name}{`);
});
