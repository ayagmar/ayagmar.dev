import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { aboutFile } from '../scripts/ship-resume.ts';
import { parseAbout } from '../src/data/about.ts';
import { site, siteUrl } from '../src/lib/site.ts';

const committed = JSON.parse(readFileSync(aboutFile, 'utf8'));
const edit = (change: (data: typeof committed) => void) => {
  const data = structuredClone(committed);
  change(data);
  return () => parseAbout(data);
};

describe('content/about.json', () => {
  // site.ts feeds the layout, feeds and astro.config, which cannot read a content collection.
  it('agrees with the site identity', () => {
    const { name, role, location, links } = committed.identity;
    expect({ author: site.author, role: site.role, location: site.location }).toEqual({
      author: name,
      role,
      location,
    });
    expect({ ...site.links, site: siteUrl }).toEqual({
      github: links.github,
      x: links.x,
      lastfm: links.lastfm,
      site: links.site,
    });
  });

  it('names the field when a value is wrong', () => {
    expect(
      edit((data) => {
        data.experience[1].start = 'March 2022';
      })
    ).toThrow(
      'content/about.json is invalid:\n✖ must be a month like 2025-05\n  → at experience[1].start'
    );
  });

  it('rejects a misspelled field instead of dropping it', () => {
    expect(
      edit((data) => {
        data.resume.publish = true;
      })
    ).toThrow(/Unrecognized key: "publish"\n {2}→ at resume/);
  });

  it('keeps the resume order newest first', () => {
    expect(
      edit((data) => {
        data.experience.reverse();
      })
    ).toThrow(/must be newest first\n {2}→ at experience$/);
  });
});
