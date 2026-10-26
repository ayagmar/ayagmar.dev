import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileResume } from '../scripts/resume.ts';
import { generatedResume, readAbout, repoRoot } from '../scripts/ship-resume.ts';
import { formatMonth } from '../src/data/about.ts';
import { expect, test } from './fixtures.ts';

const about = readAbout();

test('the about page names whose history it is', async ({ page }) => {
  await page.goto('/about');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(about.identity.name);
});

// The committed about.json decides which state this run checks; the component test covers both.
if (about.resume.published) {
  test('the about page links a resume PDF that is served', async ({ page, request }) => {
    await page.goto('/about');
    const href = await page.getByRole('link', { name: 'Resume (PDF)' }).getAttribute('href');
    const response = await request.get(href ?? '');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toBe('application/pdf');
  });
} else {
  test('the about page says the resume is coming soon and does not serve it', async ({
    page,
    request,
  }) => {
    await page.goto('/about');
    const placeholder = page.getByRole('button', { name: 'Resume PDF: coming soon' });
    await expect(placeholder).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByRole('link', { name: /resume/i })).toHaveCount(0);
    await expect(placeholder).toHaveAccessibleDescription(/not available to download yet/);
    expect((await request.get('/resume.pdf')).status()).toBe(404);
  });
}

/** Every fact the page and the PDF must show, as plain strings. */
const facts = [
  about.identity.name,
  about.summary,
  ...about.experience.flatMap((role) => [
    role.role,
    role.company,
    role.place,
    formatMonth(role.start),
    role.end === null ? 'present' : formatMonth(role.end),
    ...role.outcomes,
  ]),
  ...about.certifications.flatMap((cert) => [
    cert.name,
    cert.issuer,
    formatMonth(cert.issued),
    ...(cert.expires === undefined ? [] : [formatMonth(cert.expires)]),
    ...(cert.credentialId === undefined ? [] : [cert.credentialId]),
  ]),
  ...about.education.flatMap((school) => [
    school.school,
    school.degree,
    ...(school.field === undefined ? [] : [school.field]),
    formatMonth(school.start),
    formatMonth(school.end),
  ]),
  ...about.skills,
];
const verifyUrls = about.certifications.map((cert) => cert.verifyUrl);
// Typst sets typographic apostrophes; compare text with plain ones and single spaces.
const flat = (text: string) => text.replace(/\u2019/g, "'").replace(/\s+/g, ' ');

test('the about page shows every fact and verify link', async ({ page }) => {
  await page.goto('/about');
  const text = flat((await page.locator('main').textContent()) ?? '');
  for (const fact of facts) expect(text).toContain(flat(fact));
  const links = await page
    .getByRole('link', { name: /^Verify / })
    .evaluateAll((anchors) => anchors.map((a) => a.getAttribute('href')));
  expect(links).toEqual(verifyUrls);
});

/** Runs a poppler-utils tool: optional locally, required in CI. */
function poppler(tool: string, args: string[]): string {
  try {
    return execFileSync(tool, args, { encoding: 'utf8' });
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
    test.skip(missing && !process.env.CI, `${tool} is not installed`);
    throw error;
  }
}

test('the generated resume shows every fact and verify link', () => {
  const text = flat(poppler('pdftotext', [generatedResume, '-']));
  for (const fact of facts) expect(text).toContain(flat(fact));
  const urls = poppler('pdfinfo', ['-url', generatedResume]);
  for (const url of verifyUrls) expect(urls).toContain(url);
});

test('content that does not fit on one page fails the resume build', () => {
  const root = mkdtempSync(join(tmpdir(), 'min7-resume-'));
  try {
    cpSync(join(repoRoot, 'resume', 'resume.typ'), join(root, 'resume', 'resume.typ'));
    mkdirSync(join(root, 'content'));
    // Schema-valid, just long: the summary repeated until it fills more than a page.
    writeFileSync(
      join(root, 'content', 'about.json'),
      JSON.stringify({ ...about, summary: Array(100).fill(about.summary).join(' ') })
    );
    expect(() => compileResume(root, join(root, 'resume.pdf'))).toThrow(/exceeds one page/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
