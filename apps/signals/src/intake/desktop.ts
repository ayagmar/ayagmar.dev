import {
  type DesktopPush,
  type DesktopSnapshot,
  desktopPushSchema,
  desktopSnapshotSchema,
} from '@min7/contracts';
import type { Producer } from './producers.ts';

/**
 * The published desktop facts, built field by field from the validated push (ADR 0032). The
 * schema has already held each value to its allowlist, so a host name in a version string or
 * any unknown key never gets this far.
 */
function projectDesktop({ payload }: DesktopPush): DesktopSnapshot {
  return { kernel: payload.kernel, niri: payload.niri, bootedAt: payload.bootedAt };
}

/** A boot time before the Unix epoch or after the snapshot was taken cannot be true. */
function checkDesktop({ sentAt, payload }: DesktopPush): string | null {
  const bootedAt = Date.parse(payload.bootedAt);
  return bootedAt < 0 || bootedAt > Date.parse(sentAt) ? 'booted_at_out_of_range' : null;
}

export const desktopProducer: Producer<DesktopPush> = {
  id: 'desktop',
  source: 'desktop',
  schema: desktopPushSchema,
  snapshotSchema: desktopSnapshotSchema,
  project: projectDesktop,
  check: checkDesktop,
  tokens: (env) => [env.PUSH_TOKEN_DESKTOP, env.PUSH_TOKEN_DESKTOP_NEXT],
  signingKeys: null,
};
