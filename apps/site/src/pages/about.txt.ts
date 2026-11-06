import { getEntry } from 'astro:content';
import type { APIRoute } from 'astro';
import { renderAboutText, textFile } from '../lib/plaintext.ts';

export const GET: APIRoute = async () => {
  const entry = await getEntry('about', 'about');
  if (entry === undefined) throw new Error('content/about.json is missing');
  return textFile(renderAboutText(entry.data));
};
