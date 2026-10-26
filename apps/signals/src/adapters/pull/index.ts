import type { PullAdapter } from '../types.ts';
import { listening } from './listening.ts';
import { projects } from './projects.ts';
import { shipping } from './shipping.ts';

export { PullError, type PullErrorCode } from './http.ts';

/**
 * Every pull adapter the cron handler runs. One file per adapter in this folder. A failed
 * pull throws a `PullError`; record its `code`, which never holds upstream text.
 */
export const pullAdapters: PullAdapter[] = [listening, shipping, projects];
