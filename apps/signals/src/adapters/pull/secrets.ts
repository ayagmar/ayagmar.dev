/** Worker secrets the pull adapters read. Names only; values live in Cloudflare and `.dev.vars`. */
type PullSecret = 'LASTFM_API_KEY' | 'GITHUB_TOKEN';

/**
 * A secret's value, or undefined when it is unset or empty. Secrets are not in wrangler.jsonc,
 * so the generated `Env` does not declare them and they are read here, checked at run time.
 */
export function readSecret(env: Env, name: PullSecret): string | undefined {
  const value: unknown = Reflect.get(env, name);
  return typeof value === 'string' && value !== '' ? value : undefined;
}
