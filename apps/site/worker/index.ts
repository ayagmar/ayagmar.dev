// Runs only for the pages in assets.run_worker_first (ADR 0040): a request that prefers Markdown
// gets the page's `.md` copy or else its `.txt` one, a terminal client its `.txt` copy, and
// everything else, or any page without that copy, the static page. The copies are assets, so
// every answer carries the headers from dist/_headers. /room is the exception: a terminal asked
// for colour, which is rendered per request (ADR 0045), and everyone else goes to the home page.

import { terminalRoom } from './room.ts';

const terminalAgent = /^(curl|wget|httpie|xh)\//i;

/**
 * Whether Markdown beats HTML for `accept`. Each is rated by the most specific range that matches
 * it (RFC 9110 12.5.1), zero ranges included, so a wildcard cannot undo an exclusion. Markdown
 * must be named outright, which no browser does, and win on q, or tie and be listed first. A
 * range whose q does not parse is dropped, so a malformed header means HTML, and so is one with a
 * parameter neither copy has: both are UTF-8 and have no others.
 */
function prefersMarkdown(accept: string | null) {
  const ranges = (accept ?? '').split(',').flatMap((range) => {
    const [type = '', ...params] = range.split(';').map((part) => part.trim().toLowerCase());
    const weight = params.find((param) => /^q\s*=/.test(param))?.replace(/^q\s*=\s*/, '') ?? '1';
    const others = params.filter((param) => param !== '' && !/^q\s*=/.test(param));
    return /^(0(\.\d{0,3})?|1(\.0{0,3})?)$/.test(weight) &&
      others.every((param) => /^charset="?utf-8"?$/.test(param))
      ? [{ type, q: Number(weight), specific: others.length > 0 }]
      : [];
  });
  const named = (type: string) =>
    ranges.find((range) => range.type === type && range.specific) ??
    ranges.find((range) => range.type === type);
  const markdown = named('text/markdown');
  if (markdown === undefined || markdown.q === 0) return false;
  const html = named('text/html') ?? named('text/*') ?? named('*/*');
  if (html === undefined) return true;
  return (
    markdown.q > html.q ||
    (markdown.q === html.q && ranges.indexOf(markdown) < ranges.indexOf(html))
  );
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const terminal = terminalAgent.test(request.headers.get('user-agent') ?? '');
    const markdown = prefersMarkdown(request.headers.get('accept'));
    if (url.pathname === '/room') {
      const response =
        terminal && !markdown
          ? await terminalRoom(request, env.ASSETS, (work) => ctx.waitUntil(work))
          : new Response(null, { status: 307, headers: { Location: '/' } });
      response.headers.append('Vary', 'Accept, User-Agent');
      return response;
    }
    const copies = [...(markdown ? ['.md'] : []), ...(markdown || terminal ? ['.txt'] : [])];
    const stem = url.pathname === '/' ? '/index' : url.pathname;
    let response: Response | undefined;
    for (const extension of copies) {
      const copy = await env.ASSETS.fetch(new Request(new URL(stem + extension, url), request));
      if (copy.status !== 404) {
        response = copy;
        break;
      }
    }
    response ??= await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    headers.append('Vary', 'Accept, User-Agent');
    return new Response(response.body, { status: response.status, headers });
  },
} satisfies ExportedHandler<Env>;
