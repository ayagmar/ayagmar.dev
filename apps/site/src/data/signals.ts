// The build's reader, configured from the environment (ADR 0015).
import { SIGNALS_API_BASE, SIGNALS_MODE } from 'astro:env/server';
import { createReader } from './reader.ts';

export const signalsMode = SIGNALS_MODE;

/** Origin of the read API; the now-playing island fetches from it in `api` mode. */
export const signalsApiBase = SIGNALS_API_BASE.replace(/\/+$/, '');

export const signals = createReader({ mode: signalsMode, apiBase: signalsApiBase });

/** The time pages compute relative times against: when the build ran. */
export const builtAt = new Date();
