const encoder = new TextEncoder();

/** A secret slot holding fewer characters than this never matches (unset or placeholder). */
const minSecretLength = 32;

/** Slots come from bindings, so one can be missing or not a string even where types say otherwise. */
const usable = (secret: unknown): secret is string =>
  typeof secret === 'string' && secret.length >= minSecretLength;

const sha256 = (value: string) => crypto.subtle.digest('SHA-256', encoder.encode(value));

/**
 * Whether `provided` equals one of `accepted`. Compares SHA-256 digests, which always have
 * the same length, with `timingSafeEqual`, and checks every slot, so neither the time taken
 * nor an early exit tells a caller how close a guess was or which slot matched.
 */
export async function matchesSecret(
  provided: string,
  accepted: readonly unknown[]
): Promise<boolean> {
  const providedDigest = await sha256(provided);
  let matched = false;
  for (const secret of accepted) {
    // An unusable slot is still compared, against the empty string, so it costs the same.
    const expected = await sha256(usable(secret) ? secret : '');
    const equal = crypto.subtle.timingSafeEqual(providedDigest, expected);
    matched = (equal && usable(secret)) || matched;
  }
  return matched;
}

const hexSignature = /^[0-9a-f]{64}$/i;

/**
 * Whether `signatureHex` is the HMAC-SHA256 of `message` under one of `keys`. Verified by
 * `crypto.subtle.verify`, which compares in constant time.
 */
export async function verifyHmacSha256(
  keys: readonly unknown[],
  signatureHex: string,
  message: Uint8Array<ArrayBuffer>
): Promise<boolean> {
  if (!hexSignature.test(signatureHex)) return false;
  const signature = Uint8Array.from(signatureHex.match(/../g) ?? [], (byte) =>
    Number.parseInt(byte, 16)
  );
  let verified = false;
  for (const secret of keys.filter(usable)) {
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    verified = (await crypto.subtle.verify('HMAC', key, signature, message)) || verified;
  }
  return verified;
}
