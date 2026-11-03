// Runs only for the pages that have a plain-text version (assets.run_worker_first): terminal
// clients get the text, everything else gets the static HTML. Both carry the headers from
// dist/_headers.

const terminalAgent = /^(curl|wget|httpie|xh)\//i;

// Built by src/pages/index.txt.ts and src/pages/now.txt.ts.
const plainText: Record<string, string> = { '/': '/index.txt', '/now': '/now.txt' };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const text = plainText[url.pathname];
    const isTerminal = terminalAgent.test(request.headers.get('user-agent') ?? '');
    const asset =
      isTerminal && text !== undefined ? new Request(new URL(text, url), request) : request;
    const response = await env.ASSETS.fetch(asset);
    const headers = new Headers(response.headers);
    headers.append('Vary', 'User-Agent');
    return new Response(response.body, { status: response.status, headers });
  },
} satisfies ExportedHandler<Env>;
