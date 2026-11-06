import { rabatDate } from '@min7/contracts/rabat';

/**
 * Whether the runtime's tzdata knows Morocco's current rules: +00 for good since 2026-09-20
 * 01:00 UTC (tzdata 2026c). With older rules it is still +01 there, so the date flips an hour
 * early and the room's lamp would be an hour off. If Morocco changes its clocks again, this check
 * moves with the new rules.
 */
export const knowsRabat = () => rabatDate(Date.UTC(2026, 9, 1, 23, 30)) === '2026-10-01';
