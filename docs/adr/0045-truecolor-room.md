# 0045. The room in truecolor for terminals

Status: accepted, 2026-11-06. Amends ADR 0027 and ADR 0040.

## Context

`curl ayagmar.dev` prints the room as hand-drawn ASCII (ADR 0027) above the text index (ADR 0040). The owner wants the real pixel room in a terminal, with the sky over Rabat, what is playing and the latest commit as they are now: something a developer runs and shares. Plain output has to stay honest. Pipes, `wget`, agents and `Accept: text/markdown` keep their answers.

## Decision

**The colour room has its own URL, `/room`, and `curl ayagmar.dev` stays plain.** A server cannot see a terminal. `curl ayagmar.dev` and `curl ayagmar.dev | grep rust` send the same bytes, and so does an agent running curl; `NO_COLOR`, `COLORTERM` and `isatty` never leave the machine. So colour on `/` would put about 33 KB of escape codes into every pipe, file and agent's context, and `e2e/text.spec.ts`, which sends what curl sends and expects `index.txt`, would have to change. Asking for colour by URL is the only signal that means what it says. `index.txt` gets one new line, under the links, that names `/room`.

If the owner prefers colour on the bare command, as wttr.in does, the change is to answer `/` like `/room` for a curl agent, and accept what that does to pipes and agents. The plain copy stays at `/index.txt`.

**A path, not `/?color` or `/?plain`.** zsh, the default shell on macOS, treats an unquoted `?` as a glob and refuses the command with "no matches found". `curl ayagmar.dev/room` needs no quoting. The output's last line gives the way out: `Without colour: curl ayagmar.dev`.

| Client at `/room`                           | Answer                    |
| ------------------------------------------- | ------------------------- |
| `curl`, `wget`, HTTPie, `xh` (ADR 0005)     | The room, `text/plain`    |
| The same, with `Accept` preferring Markdown | 307 to `/`                |
| Anything else                               | 307 to `/`, the home page |

**One drawing.** `src/pages/terminal/[frame].rgb.ts` composites the PNGs `scene.py` already draws (a room and a window layer) with sharp at build time and shrinks them to 80 by 26 cells of 6x6 scene pixels, the mean of each cell; the scene's last 4 rows go, so a cell is square. That is 6,240 bytes a frame, five frames: `day`, `dusk`, `dusk-dim`, `night`, `night-dim`. The terminal has no theme, so the sky picks the room: the lamp is on from dusk. Each character is `▀`, two cells in 13 rows of 80 columns. `just scene` needs no extra step, as the frames are built from its output.

**What is live.** `src/lib/terminal-room.ts` renders per request from `roomFacts(time)`: `skyAt`, `moonAt`, `isLate` and `rabatTime` from `sky.ts`, and nothing else in the picture. `RoomFacts` is the input a later room model replaces. The moon comes from `moonRuns`, the runs the page's SVG path is made of. The 12-pixel disc covers two cells a side, so the phase shows only as how bright they are, and the window's sentence, now `windowWords` in `sky.ts` for both, names it. The words are the page's: `nowPlaying` and `nowPlayingMarkup` for the track, `shippingItem` for the newest push or merge, both written out by `inline` (`src/lib/markup-text.ts`, moved from `stats-text.ts`). Weather and the cat stay on the page: the first costs a third read and 14 layers, and the cat's hours live in `room.css`.

**Signals.** `worker/room.ts` asks `/v1/listening` and `/v1/shipping` on the public API with a 1 s deadline, through the readers the browser uses (`readAnswer`, `readListening`, `readShipping`), so the Worker loads no zod. Each answer, or failure, is usually kept 60 s in the data centre's cache. That cache is best-effort: it is per data centre, terminals arriving together on a cold cache each ask, and requests cannot share a pending read, since a Worker may not await a promise from another request's context. A hard ceiling would need coordination, such as a Durable Object, which a decorative line does not justify. The cache is optional for each source on its own: a failed lookup, an unreadable entry or anything past the 1 s deadline means that source shows the build's answer, and a failed write changes nothing. A same-zone `fetch` works because signals is on a Custom Domain (Cloudflare's Custom Domains docs); no service binding ties the two Workers together. "Now playing" is decided when the room is rendered, after the reads, by `isCurrent` in `live.ts`, the test the browser uses: `stale: false`, within the listening limit and not older than the build's answer. A cached answer can pass the limit, so the flag alone is not enough. The limit is `staleAfterSeconds.listening`, which the build writes into `room.json` as the Worker does not load contracts. An expired answer still gives a dated "Last played", and the newer of the live and build answers is the one shown, for shipping too. When signals fails, the room shows the build's own snapshot from `/terminal/room.json`, which says "Last played" with its date. The sky and moon need no data, so they stay true. In fixtures mode, Previews and tests included, that file names no API: the Worker asks nobody and the output says `Sample data, not live`.

The cache is per data centre, and Cloudflare's docs only promise it on custom domains, so a Preview would not cache; a Preview asks nobody anyway.

**Cost per request, measured.**

| What                            | Number                                                                      |
| ------------------------------- | --------------------------------------------------------------------------- |
| Site Worker runs                | 1, against the shared 100,000 a day (ADR 0040)                              |
| Signals Worker runs             | Typically 2 per minute per data centre, up to 2 per request on a cold cache |
| Asset reads through the binding | 3: the frame, `room.json`, `index.txt` for its headers                      |
| Rendering                       | 0.32 ms in Node, 500 runs                                                   |
| Response                        | About 33 KB, 8 KB gzip                                                      |
| Worker bundle                   | 23.0 KiB, 8.0 KiB gzip                                                      |

**Other people's text.** A track or pull request title goes to a terminal, where an escape sequence is a command. `terminalLine` removes every control and format character from each line that carries such a title and cuts it at 80 terminal cells between graphemes (`Intl.Segmenter`, with a short table of wide ranges and emoji rather than a dependency), so a CJK title does not wrap. The table is not the full East Asian Width data: a rare wide character outside it can still wrap a line by a cell or two, which costs looks and nothing else.

**Headers.** The answer copies `index.txt`'s headers, so it has the `_headers` rules and `noindex`, without the ETag. It is `no-store`, as it changes by the minute.

**Links.** Commands use `buildOrigin`, as `llms.txt` does, through `curlTarget`: the bare host on production, the whole origin on a Preview. `request.url` would not do: `wrangler dev` reports the route's host. The commands are `textPages` from `site.ts`, the nav without /skills, which has no copy. No post is listed, so no draft can appear.

**A terminal without truecolor.** The server cannot tell and sends the same bytes. Terminals that parse `38;2` but have fewer colours pick the nearest. One that does not parse it shows wrong colours or stray attributes; macOS Terminal.app before macOS 26 is reported to be such a terminal, though Apple documents no version. The last line's plain copy is the answer. A 256-colour variant was left out until someone asks for it.

## Consequences

- `/room` is the one routed path whose answer is computed; its cost is above, and cutting it from `run_worker_first` turns it off.
- The build writes `/terminal/*.rgb` and `/terminal/room.json`, public and unlinked. The JSON holds the same public snapshots /stats shows.
- The Worker's TypeScript project has the DOM library, because `live.ts`, `listening.ts` and `markup.ts` hold browser code next to the pure functions it imports. Workers' and the DOM's types disagree in places, so the Worker uses `caches.open` and `toNode` uses `appendChild`.
- Moving the window in `scene.py` moves the frames with it; `moonDisc` in `sky.ts` moves by hand, for the page and the terminal.
