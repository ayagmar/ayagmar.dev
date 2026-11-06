// Runs only for the pages in assets.run_worker_first (ADR 0040): a request that prefers Markdown
// gets the page's `.md` copy or else its `.txt` one, a terminal client its `.txt` copy, and
// everything else, or any page without that copy, the static page. The copies are assets, so
// every answer carries the headers from dist/_headers.

const terminalAgent = /^(curl|wget|httpie|xh)\//i;

// What this site can answer with. A range outside it says nothing about a page's format.
const served = new Set(['text/markdown', 'text/html', 'application/xhtml+xml', 'text/*', '*/*']);

/**
 * Whether `text/markdown` is what `accept` ranks first among the types above: named outright,
 * with a higher q than HTML or a wildcard, or the same q and listed first. A browser never names
 * it. A range with a q that does not parse is dropped, so a malformed header means HTML.
 */
function prefersMarkdown(accept: string | null) {
  const ranges = (accept ?? '').split(',').flatMap((range) => {
    const [type = '', ...params] = range.split(';').map((part) => part.trim().toLowerCase());
    const weight = params.find((param) => /^q\s*=/.test(param))?.replace(/^q\s*=\s*/, '') ?? '1';
    const q = /^(0(\.\d{0,3})?|1(\.0{0,3})?)$/.test(weight) ? Number(weight) : 0;
    return served.has(type) && q > 0 ? [{ type, q }] : [];
  });
  return ranges.toSorted((a, b) => b.q - a.q)[0]?.type === 'text/markdown';
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const terminal = terminalAgent.test(request.headers.get('user-agent') ?? '');
    const markdown = prefersMarkdown(request.headers.get('accept'));
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
