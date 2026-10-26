import { describe, expect, it } from 'vitest';
import { writingSchema } from '../src/lib/writing-schema.ts';

const valid = {
  title: 'A post',
  date: new Date('2026-10-20'),
  summary: 'What it is about.',
  tags: ['rust', 'home-lab'],
};

/** The field and message Astro prints next to the file name when a build fails. */
function problems(frontmatter: Record<string, unknown>) {
  const result = writingSchema.safeParse(frontmatter);
  return result.success
    ? []
    : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
}

describe('writing frontmatter', () => {
  it('accepts a minimal post and defaults draft to false', () => {
    const post = writingSchema.parse({ ...valid, tags: undefined });
    expect(post.draft).toBe(false);
    expect(post.tags).toEqual([]);
    expect(post.projects).toEqual([]);
  });

  it.each([
    ['empty title', { title: '  ' }, 'title: must not be empty'],
    ['missing summary', { summary: undefined }, 'summary: is required'],
    ['unparseable date', { date: 'last tuesday' }, 'date: must be a date like 2026-10-26'],
    ['blank date (YAML null)', { date: null }, 'date: must be a date like 2026-10-26'],
    ['boolean date', { date: true }, 'date: must be a date like 2026-10-26'],
    ['numeric date', { date: 42 }, 'date: must be a date like 2026-10-26'],
    ['impossible quoted date', { date: '2026-02-30' }, 'date: must be a date like 2026-10-26'],
    ['blank updated', { updated: null }, 'updated: must be a date like 2026-10-26'],
    [
      'uppercase tag',
      { tags: ['Rust'] },
      'tags.0: must be a lowercase slug like "rust" or "home-lab"',
    ],
    ['repeated tag', { tags: ['rust', 'rust'] }, 'tags: must not repeat a tag'],
    ['non-boolean draft', { draft: 'yes' }, 'draft: must be true or false'],
    [
      'unknown project',
      { projects: ['runnerd', 'no-such-project'] },
      expect.stringMatching(
        /^projects\.1: "no-such-project" is not a featured project in packages\/contracts\/src\/projects\.ts/
      ),
    ],
    [
      'repeated project',
      { projects: ['runnerd', 'runnerd'] },
      'projects: must not repeat a project',
    ],
    [
      'updated before date',
      { updated: new Date('2026-10-01') },
      'updated: must not be before date',
    ],
    [
      'unknown art kind',
      { art: { kind: 'mosaic' } },
      'art.kind: must be one of ascii, dither, pattern',
    ],
    [
      'unknown art palette',
      { art: { kind: 'dither', palette: 'neon' } },
      'art.palette: must be one of night, lamp, screen, zellige, wood',
    ],
    [
      'fractional art seed',
      { art: { kind: 'dither', seed: 1.5 } },
      expect.stringMatching(/^art\.seed: /),
    ],
  ])('rejects %s', (_case, change, expected) => {
    expect(problems({ ...valid, ...change })).toEqual([expected]);
  });

  // Catches art appearing on posts that did not ask for it, or a kind without its defaults.
  it('leaves art off unless asked, and defaults its seed and palette', () => {
    expect(writingSchema.parse(valid).art).toBeUndefined();
    expect(writingSchema.parse({ ...valid, art: { kind: 'pattern' } }).art).toEqual({
      kind: 'pattern',
      seed: 0,
      palette: 'night',
    });
  });

  it('reads unquoted YAML dates and quoted ISO dates as the same day', () => {
    const quoted = writingSchema.parse({ ...valid, date: '2026-10-20' });
    expect(quoted.date).toEqual(valid.date);
  });

  it('rejects unknown fields so typos do not pass silently', () => {
    expect(problems({ ...valid, sumary: 'typo' })).toEqual([expect.stringContaining('sumary')]);
  });
});
