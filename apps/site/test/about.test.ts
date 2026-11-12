import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { certificationExpiry, parseAbout } from '../src/data/about.ts';
import { renderAboutText } from '../src/lib/plaintext.ts';
import { site, siteUrl } from '../src/lib/site.ts';

const committed = JSON.parse(
  readFileSync(new URL('../../../content/about.json', import.meta.url), 'utf8')
);
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
        data.education[0].feild = 'Computer science';
      })
    ).toThrow(/Unrecognized key: "feild"\n {2}→ at education\[0\]/);
  });

  it('rejects a certification that expires before it was issued', () => {
    expect(
      edit((data) => {
        data.certifications[1].expires = '2020-01';
      })
    ).toThrow(/must not be before issued\n {2}→ at certifications\[1\]\.expires$/);
  });

  // Catches a badge named in the JSON but never committed, which would build a broken image.
  it('rejects a badge whose file is not in src/assets/badges', () => {
    expect(
      edit((data) => {
        data.certifications[0].badge.file = 'oracle-java-se-99.png';
      })
    ).toThrow(
      /src\/assets\/badges\/oracle-java-se-99\.png does not exist; add the file or drop the field\n {2}→ at certifications\[0\]\.badge\.file$/
    );
  });

  it('keeps the resume order newest first', () => {
    expect(
      edit((data) => {
        data.experience.reverse();
      })
    ).toThrow(/must be newest first\n {2}→ at experience$/);
  });
});

describe('certificationExpiry', () => {
  // Catches a certification called expired during its last month, still valid after it,
  // flagged as expiring outside its last three months, or worded in a way an old build would
  // make false.
  it.each([
    ['2027-06-30T23:00:00Z', 'valid', 'Valid to Sep 2027'],
    ['2027-07-01T00:00:00Z', 'expiring', 'Valid to Sep 2027'],
    ['2027-09-30T23:00:00Z', 'expiring', 'Valid to Sep 2027'],
    ['2027-10-01T00:00:00Z', 'expired', 'Expired Sep 2027'],
    ['2028-02-01T00:00:00Z', 'expired', 'Expired Sep 2027'],
  ])('on %s says %s', (today, state, text) => {
    expect(certificationExpiry('2027-09', new Date(today))).toMatchObject({ state, text });
  });

  // Catches a year boundary read as twelve months off.
  it('counts months across a new year', () => {
    expect(certificationExpiry('2027-01', new Date('2026-11-15T00:00:00Z')).state).toBe('expiring');
  });
});

describe('the text copy of /about', () => {
  const text = renderAboutText(parseAbout(committed), new Date('2026-11-11T12:00:00Z'));

  // Catches a terminal reader losing a certification's end or its verify link, or the
  // languages section coming back under the name of the /skills page.
  it('gives each certification its state and verify link, and lists the stack', () => {
    expect(text).toContain(
      [
        '  Claude Certified Developer - Foundations',
        '    Anthropic, issued Sep 2026. Valid to Sep 2027.',
        `    Verify: ${committed.certifications[1].verifyUrl}`,
      ].join('\n')
    );
    expect(text).toContain(
      [
        '  Professional Scrum Developer I (PSD I)',
        '    Scrum.org, issued Oct 2024. Credential ID 1145888.',
        `    Verify: ${committed.certifications[3].verifyUrl}`,
      ].join('\n')
    );
    expect(text).toContain(`\nStack\n  ${committed.stack.join(', ')}\n`);
    expect(text).not.toMatch(/^Skills$/m);
  });
});
