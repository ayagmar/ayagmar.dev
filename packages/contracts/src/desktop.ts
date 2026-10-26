// The value allowlists of the desktop facts (ADR 0032), one definition for the contract, the
// /uses page script and the producer's tests. No zod here: the browser does not load it.

/**
 * `uname -r` of an official Arch Linux kernel package: `linux` (`7.2.11-arch1-1`), `linux-lts`
 * (`6.12.20-1-lts`), `linux-zen` (`6.13.7-zen1-1-zen`) or `linux-hardened`
 * (`6.12.19-hardened1-1-hardened`). A custom build's local suffix can hold a user or host
 * name, so any other form is not published.
 */
export const kernelReleasePattern =
  /^\d{1,2}\.\d{1,3}\.\d{1,3}-(?:arch\d{1,2}-\d{1,3}|\d{1,3}-lts|zen\d{1,2}-\d{1,3}-zen|hardened\d{1,2}-\d{1,3}-hardened)$/;

/** A niri release version as `niri --version` starts it (`26.04`, `25.05.1`), without the commit. */
export const niriVersionPattern = /^\d{2}\.\d{2}(?:\.\d{1,2})?$/;

/** Longest kernel release the pattern can match; a bound for the JSON Schema too. */
export const maxKernelReleaseLength = 48;
export const maxNiriVersionLength = 8;
