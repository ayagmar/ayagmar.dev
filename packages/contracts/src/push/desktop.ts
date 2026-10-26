import { z } from 'zod';
import {
  kernelReleasePattern,
  maxKernelReleaseLength,
  maxNiriVersionLength,
  niriVersionPattern,
} from '../desktop.ts';
import { pushDeliverySchema } from './delivery.ts';

/** The running kernel, or null when it is not an official Arch kernel release. */
export const kernelReleaseSchema = z
  .string()
  .max(maxKernelReleaseLength)
  .regex(kernelReleasePattern);

/** The installed niri release, or null when its version is not a plain release number. */
export const niriVersionSchema = z.string().max(maxNiriVersionLength).regex(niriVersionPattern);

/**
 * When the machine booted, from `btime` in /proc/stat, as a UTC instant. That it is not before
 * the Unix epoch nor after `sentAt` is checked by signals at intake; JSON Schema cannot say it.
 */
export const bootedAtSchema = z.iso.datetime();

/**
 * What the desktop facts producer pushes (ADR 0032): three values, each held to a value
 * allowlist rather than a length alone, since a version string can carry a host or user name.
 */
export const desktopPushPayloadSchema = z.object({
  kernel: kernelReleaseSchema.nullable(),
  niri: niriVersionSchema.nullable(),
  bootedAt: bootedAtSchema,
});

export const desktopPushSchema = pushDeliverySchema('desktop', desktopPushPayloadSchema);

export type DesktopPush = z.infer<typeof desktopPushSchema>;
