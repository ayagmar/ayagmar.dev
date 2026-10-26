# llm-usage producer

How the owner's machine pushes llm-usage-metrics totals to `POST /v1/push/llm-usage`. The contract is [ADR 0014](../adr/0014-llm-usage-push-contract.md); this page is one way to produce it. The script is an example: it is not run by this repo or its CI.

## Script

Save as `~/.local/bin/min7-push-llm-usage.mjs`. It needs Node 22 or later and `llm-usage` on `PATH`.

```js
#!/usr/bin/env node
// Builds the llm-usage push from `llm-usage summary --json` and `llm-usage daily --json`,
// keeps it on disk until it is delivered, and pushes it. Only aggregate numbers leave
// the machine: no repo, path, model, machine, session or prompt field is read into the body.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const endpoint = 'https://api.ayagmar.dev/v1/push/llm-usage';
const token = readFileSync(process.env.MIN7_PUSH_TOKEN_FILE, 'utf8').trim();
const stateDir = join(process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state'), 'min7');
const pending = join(stateDir, 'llm-usage-pending.json');

const report = (...args) =>
  JSON.parse(execFileSync('llm-usage', [...args, '--json'], { encoding: 'utf8' })).data;

function build() {
  const summary = report('summary');
  const period = (key) => summary.periods.find((p) => p.key === key);
  const usage = (totals) => ({ costUsd: totals.costUsd ?? null, totalTokens: totals.totalTokens });
  const month = period('monthToDate');
  const dailyCost = new Map(
    report('daily', '--since', summary.activity.from)
      .filter((row) => row.source === 'combined' && row.periodKey !== 'ALL')
      .map((row) => [row.periodKey, row.costUsd ?? null])
  );
  return {
    producer: 'llm-usage',
    deliveryId: crypto.randomUUID(),
    sentAt: new Date().toISOString(),
    payload: {
      last7Days: usage(period('last7Days').totals),
      monthToDate: {
        ...usage(month.totals),
        cacheSavingsUsd: summary.monthToDateCacheSavingsUsd ?? null,
        agents: month.sources.slice(0, 32).map((s) => ({ agent: s.source, ...usage(s) })),
      },
      streak: {
        currentDays: summary.activity.currentStreak,
        longestDays: summary.activity.longestStreak,
      },
      days: summary.activity.days.map((day) => ({
        date: day.date,
        totalTokens: day.totalTokens,
        costUsd: day.totalTokens === 0 ? 0 : (dailyCost.get(day.date) ?? null),
      })),
    },
  };
}

// Resend an undelivered body unchanged, unless it is too old to be accepted (24 h).
let body;
try {
  body = readFileSync(pending, 'utf8');
  if (Date.now() - Date.parse(JSON.parse(body).sentAt) > 23 * 3600_000) body = undefined;
} catch {}
if (body === undefined) {
  body = JSON.stringify(build());
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(pending, body, { mode: 0o600 });
}

const response = await fetch(endpoint, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body,
  signal: AbortSignal.timeout(30_000),
});
const answer = await response.text();
// 2xx: delivered. 409 and 422 will never succeed with this body. Anything else: retry later.
if (response.ok || response.status === 409 || response.status === 422) rmSync(pending);
console.log(JSON.stringify({ status: response.status, answer }));
process.exitCode = response.ok ? 0 : 1;
```

Before the first run, compare one body with `packages/contracts/schema/push-llm-usage.input.json`, for example with `npx ajv-cli validate --spec=draft2020 -s push-llm-usage.input.json -d body.json`.

## systemd user units

`~/.config/systemd/user/min7-push-llm-usage.service`:

```ini
[Unit]
Description=Push llm-usage totals to api.ayagmar.dev

[Service]
Type=oneshot
Environment=MIN7_PUSH_TOKEN_FILE=%h/.config/min7/llm-usage-token
ExecStart=%h/.local/bin/min7-push-llm-usage.mjs
```

`~/.config/systemd/user/min7-push-llm-usage.timer`:

```ini
[Unit]
Description=Push llm-usage totals every 6 hours

[Timer]
OnCalendar=*-*-* 00/6:15:00
RandomizedDelaySec=10m
Persistent=true

[Install]
WantedBy=timers.target
```

Put the token in `~/.config/min7/llm-usage-token` with mode `600`, then `systemctl --user enable --now min7-push-llm-usage.timer`. A failed run leaves the body in `~/.local/state/min7/` and the next run sends it again.
