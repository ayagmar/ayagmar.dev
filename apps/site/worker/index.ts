// Runs only for `/` (assets.run_worker_first): terminal clients get the plain-text page,
// everything else gets the static HTML. Both carry the headers from dist/_headers.

const terminalAgent = /^(curl|wget|httpie|xh)\//i;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const isTerminal = terminalAgent.test(request.headers.get('user-agent') ?? '');
    const asset = isTerminal ? new Request(new URL('/index.txt', url), request) : request;
    const response = await env.ASSETS.fetch(asset);
    const headers = new Headers(response.headers);
    headers.append('Vary', 'User-Agent');
    return new Response(response.body, { status: response.status, headers });
  },
} satisfies ExportedHandler<Env>;
