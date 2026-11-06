// `just room-states`: every state of the home page room on one contact sheet, under an ignored
// directory, so a mismatch between two layers shows side by side. Never shipped. It drives the
// built home page itself, so the markup, room.css and room.ts are the real ones, and picks its
// instants with the same src/lib/sky.ts. Only the weather is set by hand: the build reads none.
import { mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, resolve } from 'node:path';
import { chromium, type Page } from '@playwright/test';
import sharp from 'sharp';
import { isLate, moonAt, type Sky, skyAt } from '../src/lib/sky.ts';
import { weatherCodes } from '../src/lib/weather.ts';

const site = resolve(import.meta.dirname, '..');
const out = join(site, '.room-states');
const tile = { width: 480, height: 160, label: 22, gap: 12 };
const columns = 4;
const hourMs = 3_600_000;
const start = Date.UTC(2026, 10, 6);

/** The first instant of the day, in steps of ten minutes, with the `wanted` sky and an awake lamp. */
function sky(wanted: Sky): number {
  for (let time = start; time < start + 24 * hourMs; time += hourMs / 6) {
    if (skyAt(time) === wanted && !isLate(time)) return time;
  }
  throw new Error(`no ${wanted} sky on the day`);
}

// Clear weather is the sky as it is, which the first tiles already show.
const weathers = [...new Set(Object.values(weatherCodes).map(([state]) => state))].filter(
  (state) => state !== 'clear'
);

/** A night for every name the moon has over the next lunar month and a bit. */
function moons(): Map<string, number> {
  const seen = new Map<string, number>();
  for (let time = start; time < start + 32 * 24 * hourMs; time += hourMs / 2) {
    const { name } = moonAt(time);
    if (skyAt(time) === 'night' && !isLate(time) && !seen.has(name)) seen.set(name, time);
  }
  return seen;
}

interface State {
  label: string;
  time: number;
  weather?: string;
}

const states: State[] = [
  { label: 'day', time: sky('day') },
  { label: 'dusk', time: sky('dusk') },
  { label: 'night', time: sky('night') },
  { label: '03:00, cat and late note', time: start + 3 * hourMs },
  { label: '06:00, late note', time: start + 6 * hourMs },
  ...(['day', 'dusk', 'night'] as const).flatMap((name) =>
    weathers.map((weather) => ({ label: `${name}, ${weather}`, time: sky(name), weather }))
  ),
  ...[...moons()].map(([label, time]) => ({ label, time })),
];

const types: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};
const server = createServer((request, response) => {
  const path = new URL(request.url ?? '/', 'http://room').pathname;
  try {
    const body = readFileSync(join(site, 'dist', path === '/' ? 'index.html' : path));
    response.writeHead(200, { 'Content-Type': types[extname(path) || '.html'] ?? 'text/plain' });
    response.end(body);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

async function shot(page: Page, state: State): Promise<Buffer> {
  await page.clock.setFixedTime(state.time);
  await page.goto(origin);
  await page.locator('.scene').evaluate((scene, weather) => {
    if (weather !== undefined) (scene as HTMLElement).dataset.weather = weather;
  }, state.weather);
  await page.waitForLoadState('networkidle');
  return page.locator('.scene').screenshot();
}

const browser = await chromium.launch();
const tiles: { label: string; image: Buffer }[] = [];
for (const [theme, colorScheme] of [
  ['Day theme', 'light'],
  ['Night theme', 'dark'],
] as const) {
  // Twice the scene's pixels, so each tile scales down by a whole number; still, so tiles compare.
  const context = await browser.newContext({
    viewport: { width: 960, height: 700 },
    colorScheme,
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  for (const state of states) {
    const image = await sharp(await shot(page, state))
      .resize(tile.width, tile.height, { kernel: 'nearest' })
      .toBuffer();
    tiles.push({ label: `${theme}: ${state.label}`, image });
  }
  await context.close();
}
await browser.close();
server.close();

// Day and night theme of a state sit next to each other.
const paired = states.flatMap((_, index) => [
  tiles[index] as (typeof tiles)[number],
  tiles[index + states.length] as (typeof tiles)[number],
]);
const cell = { width: tile.width + tile.gap, height: tile.height + tile.label + tile.gap };
const width = columns * cell.width + tile.gap;
const height = Math.ceil(paired.length / columns) * cell.height + tile.gap;
const parts = paired.flatMap(({ label, image }, index) => {
  const left = tile.gap + (index % columns) * cell.width;
  const top = tile.gap + Math.floor(index / columns) * cell.height;
  const caption = `<svg width="${tile.width}" height="${tile.label}"><text x="0" y="15" font-family="monospace" font-size="13" fill="#e8e0d0">${label}</text></svg>`;
  return [
    { input: Buffer.from(caption), left, top },
    { input: image, left, top: top + tile.label },
  ];
});
mkdirSync(out, { recursive: true });
const sheet = join(out, 'sheet.png');
await sharp({ create: { width, height, channels: 3, background: '#14121a' } })
  .composite(parts)
  .png()
  .toFile(sheet);
console.log(`room-states: ${paired.length} tiles in ${sheet}`);
