// The writing flow behind `just post`, `just til`, `just drafts` and `just publish`:
//   new <post|til> <title...> [--no-open]  write a draft, open it in the editor, serve drafts and
//                                          open its page (--no-open: only write the file)
//   drafts                                 serve drafts and print each draft's URL
//   publish <slug> [--dry-run]             set draft: false and today's date, build, open a PR
// It works on the git checkout of the current directory.
import { execFileSync, spawn } from 'node:child_process';
import {
  existsSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { connect } from 'node:net';
import { join } from 'node:path';
import { buildOrigin } from '../apps/site/src/lib/og.ts';
import { siteUrl } from '../apps/site/src/lib/site.ts';

const kinds = { post: { dir: 'writing' }, til: { dir: 'til' } } as const;
type Kind = keyof typeof kinds;

// Astro's dev port; tests point it at a port of their own so they never touch the host's 4321.
const devPort = Number(process.env.MIN7_TEST_DEV_PORT || 4321);
const devOrigin = `http://localhost:${devPort}`;

class UsageError extends Error {}

const git = (...args: string[]) =>
  execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const root = () => git('rev-parse', '--show-toplevel');
const relPath = (kind: Kind, slug: string) => `content/${kinds[kind].dir}/${slug}.md`;
const pagePath = (kind: Kind, slug: string) => `/${kinds[kind].dir}/${slug}`;

/** The publish date of anything written today: the UTC day, as posts have always used. */
const today = () => new Date().toISOString().slice(0, 10);

function slugify(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** The frontmatter block of a Markdown file: its lines and where the body starts. */
function frontmatter(text: string): { lines: string[]; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/.exec(text);
  if (!match) throw new UsageError('the file has no frontmatter block');
  return { lines: (match[1] ?? '').split(/\r?\n/), body: text.slice(match[0].length) };
}

const isDraft = (text: string) =>
  frontmatter(text).lines.some((line) => /^draft:\s*true\s*(#.*)?$/.test(line));

function newDraft(kind: Kind, title: string): { file: string; page: string } {
  const slug = slugify(title);
  if (slug === '')
    throw new UsageError(`Cannot make a file name from "${title}"; use some letters or digits.`);
  const file = relPath(kind, slug);
  const path = join(root(), file);
  if (existsSync(path)) throw new UsageError(`${file} already exists.`);
  const summary =
    kind === 'post' ? `summary: 'TODO: one sentence on what this post is about.'\n` : '';
  writeFileSync(
    path,
    `---\ntitle: ${JSON.stringify(title)}\ndate: ${today()}\n${summary}tags: []\ndraft: true\n---\n\nWrite here.\n`
  );
  console.log(`Created ${file}. \`just publish ${slug}\` when it is ready.`);
  return { file: path, page: pagePath(kind, slug) };
}

function drafts(): string[] {
  const base = root();
  return (Object.keys(kinds) as Kind[]).flatMap((kind) => {
    const dir = join(base, 'content', kinds[kind].dir);
    return readdirSync(dir)
      .filter((name) => name.endsWith('.md') && isDraft(readFileSync(join(dir, name), 'utf8')))
      .map((name) => pagePath(kind, name.slice(0, -3)));
  });
}

function listening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: 'localhost', port });
    socket.setTimeout(1000, () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

/** Starts `argv` with `arg` without waiting for it, or prints `fallback` if it cannot start. */
function launch([command, ...args]: [string, ...string[]], arg: string, fallback: string) {
  const child = spawn(command, [...args, arg], { detached: true, stdio: 'ignore' });
  child.once('error', () => console.log(fallback));
  child.unref();
}

const openInBrowser = (url: string) =>
  launch(['xdg-open'], url, `Could not open a browser; open ${url}`);

/**
 * Splits a command line into words the way a shell would, honouring quotes and backslashes, but
 * runs nothing: `$(...)`, backticks and variables stay literal text.
 */
function shellWords(line: string): string[] {
  const words: string[] = [];
  let word: string | undefined;
  let quote: "'" | '"' | undefined;
  for (let i = 0; i < line.length; i++) {
    const char = line.charAt(i);
    if (quote === "'") {
      if (char === "'") quote = undefined;
      else word += char;
    } else if (quote === '"') {
      if (char === '"') quote = undefined;
      else if (char === '\\' && '"\\$`'.includes(line.charAt(i + 1))) word += line.charAt(++i);
      else word += char;
    } else if (/\s/.test(char)) {
      if (word !== undefined) words.push(word);
      word = undefined;
    } else {
      word ??= '';
      if (char === "'" || char === '"') quote = char;
      else if (char === '\\') word += line.charAt(++i);
      else word += char;
    }
  }
  if (quote) throw new UsageError(`Unclosed ${quote} in the editor command: ${line}`);
  if (word !== undefined) words.push(word);
  return words;
}

/**
 * Opens `path` in $VISUAL, else $EDITOR, without its --wait (-w) so the dev server starts at once.
 * A terminal editor would share the terminal with the server, so it suits only a GUI editor.
 */
function openInEditor(path: string) {
  const editor = shellWords(process.env.VISUAL || process.env.EDITOR || '').filter(
    (word) => word !== '--wait' && word !== '-w'
  );
  const [command, ...args] = editor;
  if (command === undefined) console.log(`Edit ${path}`);
  else launch([command, ...args], path, `Could not start ${command}; edit ${path}`);
}

/** The pid of the process listening on TCP `port`, read from /proc (Linux), if it is the user's. */
function listenerPid(port: number): number | undefined {
  const hex = `:${port.toString(16).toUpperCase().padStart(4, '0')}`;
  const sockets = new Set<string>();
  for (const table of ['/proc/net/tcp', '/proc/net/tcp6']) {
    if (!existsSync(table)) continue;
    for (const line of readFileSync(table, 'utf8').split('\n').slice(1)) {
      // sl local_address rem_address st ... inode; st 0A is LISTEN.
      const fields = line.trim().split(/\s+/);
      if (fields[1]?.endsWith(hex) && fields[3] === '0A' && fields[9])
        sockets.add(`socket:[${fields[9]}]`);
    }
  }
  if (sockets.size === 0) return undefined;
  for (const pid of readdirSync('/proc').filter((name) => /^\d+$/.test(name))) {
    try {
      for (const fd of readdirSync(`/proc/${pid}/fd`))
        if (sockets.has(readlinkSync(`/proc/${pid}/fd/${fd}`))) return Number(pid);
    } catch {
      // Another user's process, or one that just exited.
    }
  }
  return undefined;
}

/**
 * Whether the server on `port` is this checkout's dev server with drafts shown: a process whose
 * working directory is inside this checkout and that started with PUBLIC_SHOW_DRAFTS=1.
 */
function checkServer(port: number): 'drafts' | 'no-drafts' | 'unknown' {
  const pid = listenerPid(port);
  if (pid === undefined) return 'unknown';
  try {
    const cwd = realpathSync(`/proc/${pid}/cwd`);
    const base = realpathSync(root());
    if (cwd !== base && !cwd.startsWith(`${base}/`)) return 'unknown';
    const env = readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0');
    return env.includes('PUBLIC_SHOW_DRAFTS=1') ? 'drafts' : 'no-drafts';
  } catch {
    return 'unknown';
  }
}

/**
 * Serves the site with drafts shown on port 4321, or uses the server already there, then prints
 * `paths` as URLs and opens `open` in the browser.
 */
async function serveDrafts(paths: string[], open?: string) {
  const announce = async () => {
    for (const path of paths) console.log(`${devOrigin}${path}`);
    if (!open) return;
    // A running server picks up a new file within a second or so; until then the page is a 404.
    for (let tries = 0; tries < 20; tries++) {
      const status = await fetch(`${devOrigin}${open}`, { signal: AbortSignal.timeout(1000) }).then(
        (response) => response.status,
        () => 0
      );
      if (status !== 404) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    openInBrowser(`${devOrigin}${open}`);
  };
  if (await listening(devPort)) {
    const server = checkServer(devPort);
    if (server === 'no-drafts')
      throw new UsageError(
        `This checkout's dev server on ${devOrigin} hides drafts. Stop it (Ctrl-C, or \`pnpm --filter @min7/site exec astro dev stop\`) and run \`just drafts\`.`
      );
    if (server === 'unknown')
      throw new UsageError(
        `Port ${devPort} is taken by something other than this checkout's dev server with drafts (another project or worktree?). Stop it and run \`just drafts\`.`
      );
    console.log(`Using this checkout's dev server on ${devOrigin}.`);
    await announce();
    return;
  }
  const server = spawn('just', ['site-dev'], {
    cwd: root(),
    stdio: 'inherit',
    env: { ...process.env, PUBLIC_SHOW_DRAFTS: '1' },
  });
  // Ctrl-C reaches the server too; wait for it to stop instead of leaving it behind.
  process.on('SIGINT', () => {});
  const exited = new Promise<number>((resolve) =>
    server.once('exit', (code) => resolve(code ?? 1))
  );
  let stopped = false;
  void exited.then(() => {
    stopped = true;
  });
  // Astro may detach the server and exit once it is ready (it does when it detects an agent).
  for (;;) {
    const lastLook = stopped;
    if (await listening(devPort)) {
      await announce();
      break;
    }
    if (lastLook) break;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  process.exitCode = await exited;
}

function findDraft(slug: string): Kind {
  const base = root();
  const found = (Object.keys(kinds) as Kind[]).filter((kind) =>
    existsSync(join(base, relPath(kind, slug)))
  );
  const [kind, ...more] = found;
  if (kind === undefined)
    throw new UsageError(`No post or note named ${slug} (content/writing or content/til).`);
  if (more.length > 0)
    throw new UsageError(
      `Both ${found.map((kind) => relPath(kind, slug)).join(' and ')} exist; rename one.`
    );
  return kind;
}

/** Today's date and `draft: false` in the frontmatter; every other line, `updated` included, stays. */
function published(text: string): string {
  const { lines, body } = frontmatter(text);
  const next = lines.map((line) =>
    /^draft:/.test(line) ? 'draft: false' : /^date:/.test(line) ? `date: ${today()}` : line
  );
  return `---\n${next.join('\n')}\n---\n${body}`;
}

/**
 * The branch a slug is published on: `content/<slug>`, the slug cut short (never ending in a
 * hyphen) when the Preview's name would not fit one DNS label, so it still gets a Preview URL.
 */
function publishBranch(slug: string): string {
  for (let length = slug.length; length > 0; length--) {
    const branch = `content/${slug.slice(0, length).replace(/-+$/, '')}`;
    if (buildOrigin(branch) !== siteUrl) return branch;
  }
  throw new UsageError(`No Preview URL fits a branch for ${slug}.`);
}

function publish(slug: string, dryRun: boolean) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
    throw new UsageError(`"${slug}" is not a slug; pass the file name without .md.`);
  const kind = findDraft(slug);
  const file = relPath(kind, slug);
  const path = join(root(), file);
  const text = readFileSync(path, 'utf8');
  if (!isDraft(text)) throw new UsageError(`${file} is not a draft (no draft: true).`);

  // Not trimmed: each line starts with two status columns, the first often a space.
  const others = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {
    encoding: 'utf8',
  })
    .split('\n')
    .filter((line) => line !== '' && line.slice(3) !== file);
  if (others.length > 0)
    throw new UsageError(
      `Other changes are in the tree; commit or set them aside first:\n${others.join('\n')}`
    );

  git('fetch', '--quiet', 'origin', 'main');
  if (git('rev-parse', 'HEAD') !== git('rev-parse', 'origin/main'))
    throw new UsageError(
      'HEAD is not origin/main. Switch to main and pull first: git switch main && git pull --ff-only'
    );

  try {
    execFileSync('gh', ['auth', 'status'], { stdio: 'ignore' });
  } catch {
    throw new UsageError('gh is missing or not logged in; run `gh auth login` first.');
  }

  const branch = publishBranch(slug);
  if (
    git('branch', '--list', branch) !== '' ||
    git('ls-remote', '--heads', 'origin', branch) !== ''
  )
    throw new UsageError(`Branch ${branch} already exists here or on origin.`);

  const message = `content(${kinds[kind].dir}): publish ${slug}`;
  const preview = `${buildOrigin(branch)}${pagePath(kind, slug)}`;
  if (dryRun) {
    console.log(`Would publish ${file}:
  1. set draft: false and date: ${today()} (updated stays)
  2. just site-build (restores the draft if it fails)
  3. git switch -c ${branch} and commit "${message}"
  4. git push -u origin ${branch}
  5. gh pr create --base main --title "${message}"
Preview, once Workers Builds finishes: ${preview}`);
    return;
  }

  // The draft's index entry before anything changes ("mode oid stage\tpath", or none), to put
  // back exactly if the commit fails: a staged draft stays staged, an untracked one untracked.
  const staged = /^(\d+) ([0-9a-f]+) 0\t/.exec(git('ls-files', '--stage', '--', file));
  writeFileSync(path, published(text));
  try {
    execFileSync('just', ['site-build'], { stdio: 'inherit' });
  } catch {
    writeFileSync(path, text);
    throw new UsageError(
      `The build failed, so ${file} is a draft again. Fix it and run \`just publish ${slug}\` again.`
    );
  }
  const run = (cmd: string, ...args: string[]) => execFileSync(cmd, args, { stdio: 'inherit' });
  const start = git('rev-parse', 'HEAD');
  const startBranch = execFileSync('git', ['branch', '--show-current'], {
    encoding: 'utf8',
  }).trim();
  let created = false;
  try {
    run('git', 'switch', '--quiet', '-c', branch);
    created = true;
    run('git', 'add', '--', file);
    run('git', 'commit', '--quiet', '-m', message, '--', file);
  } catch {
    // Nothing is committed: put the branch, the index entry and the draft back as they were.
    const quiet = (...args: string[]) => execFileSync('git', args, { stdio: 'ignore' });
    const notes: string[] = [];
    if (created) {
      try {
        quiet(
          ...(startBranch
            ? ['switch', '--quiet', startBranch]
            : ['switch', '--quiet', '--detach', start])
        );
        // Deletes the branch only while it still points where this run made it.
        quiet('update-ref', '-d', `refs/heads/${branch}`, start);
      } catch {
        notes.push(
          `${branch} was left as it is; delete it with \`git branch -d ${branch}\` once you are off it.`
        );
      }
    } else
      notes.push(
        `${branch} could not be made (did something else just create it?) and was not touched.`
      );
    try {
      if (staged)
        quiet('update-index', '--add', '--cacheinfo', `${staged[1]},${staged[2]},${file}`);
      else quiet('rm', '--cached', '--quiet', '--ignore-unmatch', '--', file);
    } catch {
      notes.push(`The index entry of ${file} could not be put back; check \`git status\`.`);
    }
    writeFileSync(path, text);
    throw new UsageError(
      [`Committing failed, so nothing was published: ${file} is a draft again.`, ...notes].join(
        '\n'
      )
    );
  }
  const finish = (failed: string, steps: string[]) =>
    new UsageError(`${failed} The commit "${message}" is on ${branch}. To finish:
${steps.map((step) => `  ${step}`).join('\n')}
Preview, once Workers Builds finishes: ${preview}`);
  const prCommand = `gh pr create --base main --head ${branch} --fill`;
  try {
    run('git', 'push', '--quiet', '-u', 'origin', branch);
  } catch {
    throw finish('The push failed.', [`git push -u origin ${branch}`, prCommand]);
  }
  let pr: string;
  try {
    pr = execFileSync(
      'gh',
      [
        'pr',
        'create',
        '--base',
        'main',
        '--head',
        branch,
        '--title',
        message,
        '--body',
        `Publishes \`${file}\` at \`${pagePath(kind, slug)}\`. \`just site-build\` passed with it.`,
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }
    ).trim();
  } catch {
    throw finish(`Pushed ${branch}, but opening the pull request failed.`, [prCommand]);
  }
  console.log(`Pull request: ${pr}
Preview, once Workers Builds finishes (the PR gets a comment with it): ${preview}
You are on ${branch}; push more commits there to change the PR. Merging it publishes the ${kind}.`);
}

const usage =
  'Usage: writing.ts new <post|til> <title> [--no-open] | drafts | publish <slug> [--dry-run]';
const options: Record<string, string[]> = {
  new: ['--no-open'],
  drafts: [],
  publish: ['--dry-run'],
};

async function main(argv: string[]) {
  const flags = argv.filter((arg) => arg.startsWith('--'));
  const [command = '', ...rest] = argv.filter((arg) => !arg.startsWith('--'));
  const allowed = options[command];
  if (!allowed) throw new UsageError(usage);
  const unknown = flags.filter((flag) => !allowed.includes(flag));
  if (unknown.length > 0) throw new UsageError(`Unknown option ${unknown.join(', ')}\n${usage}`);

  if (command === 'new') {
    const [kind = '', ...words] = rest;
    const title = words.join(' ').trim();
    if (!(kind === 'post' || kind === 'til') || title === '')
      throw new UsageError(`Usage: just ${kind === 'til' ? 'til' : 'post'} "Title" [--no-open]`);
    const { file, page } = newDraft(kind, title);
    if (flags.includes('--no-open'))
      console.log(`Read it with \`just drafts\` at ${devOrigin}${page}`);
    else {
      openInEditor(file);
      await serveDrafts([page], page);
    }
  } else if (command === 'drafts') {
    const pages = drafts();
    if (pages.length === 0) console.log('No drafts.');
    await serveDrafts(pages);
  } else {
    const [slug, ...extra] = rest;
    if (slug === undefined || extra.length > 0)
      throw new UsageError('Usage: just publish <slug> [--dry-run]');
    publish(slug, flags.includes('--dry-run'));
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  if (!(error instanceof UsageError)) throw error;
  console.error(error.message);
  process.exitCode = 1;
});
