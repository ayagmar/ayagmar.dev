import { getEntry } from 'astro:content';
import type { APIRoute } from 'astro';
import { renderUsesText, textFile } from '../lib/plaintext.ts';

export const GET: APIRoute = async () => {
  const entry = await getEntry('uses', 'uses');
  if (entry === undefined) throw new Error('content/uses.json is missing');
  return textFile(renderUsesText(entry.data));
};
