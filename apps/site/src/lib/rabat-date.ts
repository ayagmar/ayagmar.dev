import { rabatDate } from '@min7/contracts/rabat';

/**
 * Whether the browser's tzdata knows Morocco's current rules, +00 for good since 2026-09-20
 * 01:00 UTC: with older rules it is still +01 there, and the date flips an hour early. The
 * room's `knowsRabatTime` (src/lib/sky.ts) checks the same; this copy keeps the /stats and
 * /uses scripts from sharing a chunk with the home page's.
 */
export const knowsRabatDate = () => rabatDate(Date.UTC(2026, 9, 1, 23, 30)) === '2026-10-01';
