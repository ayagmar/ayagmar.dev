// CPU per cron invocation of a signals pull adapter, measured locally in workerd (ADR 0030).
// Starts the bench Worker (apps/signals/bench) with `wrangler dev` once per scenario and
// reads the CPU time Linux charged to the workerd process running it (every thread's
// /proc/<pid>/task/<tid>/schedstat, in nanoseconds) around one cold invocation, the first in
// a fresh isolate, and around ten warm ones. Each scenario's number is less the same
// measure for a cron invocation with no adapter due, measured the same way. Waiting on
// timers or the network costs no CPU, but local D1 runs in the same process, so each D1
// query a scenario adds counts too, which in production runs elsewhere.
// DevTools CPU profiles are no good for totals here: local workerd does not mark idle time,
// so the 300 ms pacing waits show up as JavaScript. Production runs on other hardware:
// compare scenarios with each other and with production's numbers for the adapters already
// deployed (listening), not with the 10 ms limit directly. Linux only.
// Usage: node scripts/signals-cpu.ts [scenario...]
import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { freePort } from './free-port.ts';

const app = join(import.meta.dirname, '..', 'apps/signals');
const wrangler = join(app, 'node_modules/.bin/wrangler');
const config = join(app, 'bench/wrangler.jsonc');
const persist = join(app, '.wrangler/bench');
let port = 0;
const warmRuns = 10;

const allScenarios = [
  'listening',
  'history-first',
  'history-full-page',
  'history-last-of-24',
  'monkeytype',
  'monkeytype-max',
  'activity',
  'activity-max',
  'activity-daily',
  'activity-daily-max',
  'activity-hourly',
  'activity-hourly-max',
];
const scenarios = process.argv.length > 2 ? process.argv.slice(2) : allScenarios;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor<T>(attempt: () => Promise<T>): Promise<T> {
  for (let tries = 0; ; tries++) {
    try {
      return await attempt();
    } catch (error) {
      if (tries > 120) throw error;
      await sleep(500);
    }
  }
}

const get = async (path: string) => {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  const text = await response.text();
  if (!response.ok) throw new Error(`${path}: ${response.status} ${text}`);
  return text;
};

/**
 * Nanoseconds on CPU so far, over every thread of the workerd process that runs the Worker:
 * the one wrangler gives the inspector to. The other one only proxies requests to it.
 */
function cpuNs(group: number): number {
  const pids = execFileSync(
    'pgrep',
    ['-g', String(group), '-f', 'workerd serve.*--inspector-addr'],
    {
      encoding: 'utf8',
    }
  )
    .trim()
    .split('\n');
  let total = 0;
  for (const pid of pids) {
    for (const tid of readdirSync(`/proc/${pid}/task`)) {
      total += Number(readFileSync(`/proc/${pid}/task/${tid}/schedstat`, 'utf8').split(' ')[0]);
    }
  }
  return total;
}

/** Milliseconds of CPU one invocation of `scenario` took. */
async function run(group: number, scenario: string) {
  await get(`/setup?scenario=${scenario}`);
  const before = cpuNs(group);
  const row = JSON.parse(await get(`/run?scenario=${scenario}`)) as {
    last_error_code: string | null;
  } | null;
  const ms = (cpuNs(group) - before) / 1e6;
  if (row?.last_error_code) throw new Error(`${scenario}: pull failed, ${row.last_error_code}`);
  return ms;
}

const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;

/** Cold and warm (median of ten) milliseconds of `scenario` in a fresh wrangler dev. */
async function measure(scenario: string) {
  let dev: ChildProcess | undefined;
  try {
    port = await freePort();
    dev = spawn(
      wrangler,
      [
        'dev',
        '--config',
        config,
        '--persist-to',
        persist,
        '--ip',
        '127.0.0.1',
        '--port',
        String(port),
        '--log-level',
        'error',
      ],
      { cwd: app, stdio: 'ignore', detached: true }
    );
    const group = dev.pid ?? 0;
    await waitFor(() => get(`/prepare?scenario=${scenario}`));
    await sleep(500);
    const cold = await run(group, scenario);
    const warm: number[] = [];
    for (let i = 0; i < warmRuns; i++) warm.push(await run(group, scenario));
    return { cold, warm: median(warm), max: Math.max(...warm) };
  } finally {
    if (dev?.pid !== undefined) process.kill(-dev.pid, 'SIGTERM');
    await sleep(1500);
  }
}

rmSync(persist, { recursive: true, force: true });
execFileSync(
  wrangler,
  ['d1', 'migrations', 'apply', 'DB', '--local', '--config', config, '--persist-to', persist],
  { cwd: app, stdio: 'ignore', env: { ...process.env, CI: '1' } }
);

const base = await measure('baseline');
console.log(
  `baseline (no adapter due): cold ${base.cold.toFixed(2)} ms, warm median ${base.warm.toFixed(2)} ms`
);
for (const scenario of scenarios) {
  const m = await measure(scenario);
  console.log(
    `${scenario}: cold ${(m.cold - base.cold).toFixed(2)} ms, warm median ${(m.warm - base.warm).toFixed(2)} ms (max ${(m.max - base.warm).toFixed(2)}), over the baseline`
  );
}
