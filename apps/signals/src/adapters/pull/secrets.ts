/** Worker secrets the pull adapters read. Names only; values live in Cloudflare and `.dev.vars`. */
type PullSecret = 'LASTFM_API_KEY' | 'GITHUB_TOKEN' | 'MONKEYTYPE_APE_KEY';

/**
 * A secret's value, or undefined when it is unset or empty. `GITHUB_TOKEN` and
 * `MONKEYTYPE_APE_KEY` are optional, so the generated `Env` does not declare them, and a
 * required secret can still be missing locally; all are read here, checked at run time.
 */
export function readSecret(env: Env, name: PullSecret): string | undefined {
  const value: unknown = Reflect.get(env, name);
  return typeof value === 'string' && value !== '' ? value : undefined;
}
