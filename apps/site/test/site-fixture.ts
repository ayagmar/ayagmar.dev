// A throwaway copy of the site's content setup for tests that run a real `astro build`: the
// content config with the schema modules it imports (src/lib, src/data/about.ts) and
// content/about.json, the repo's layout (so ../../content resolves), the site's
// node_modules, and a temporary HOME. Nothing is written outside the temporary directory.
import { type SpawnSyncReturns, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const site = join(import.meta.dirname, '..');

export interface SiteFixture {
  root: string;
  app: string;
  /** Writes a file relative to the fixture's repo root, such as `content/writing/a.md`. */
  write(path: string, text: string): void;
  build(): SpawnSyncReturns<string>;
  remove(): void;
}

export function siteFixture(prefix: string): SiteFixture {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const app = join(root, 'apps/site');
  mkdirSync(join(app, 'src'), { recursive: true });
  copyFileSync(join(site, 'src/content.config.ts'), join(app, 'src/content.config.ts'));
  cpSync(join(site, 'src/lib'), join(app, 'src/lib'), { recursive: true });
  mkdirSync(join(app, 'src/data'));
  copyFileSync(join(site, 'src/data/about.ts'), join(app, 'src/data/about.ts'));
  mkdirSync(join(root, 'content'));
  copyFileSync(join(site, '../../content/about.json'), join(root, 'content/about.json'));
  symlinkSync(join(site, 'node_modules'), join(app, 'node_modules'), 'dir');
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  return {
    root,
    app,
    write,
    build: () =>
      spawnSync(process.execPath, [join(site, 'node_modules/astro/bin/astro.mjs'), 'build'], {
        cwd: app,
        encoding: 'utf8',
        env: { ...process.env, HOME: root, ASTRO_TELEMETRY_DISABLED: '1' },
      }),
    remove: () => rmSync(root, { recursive: true, force: true }),
  };
}
