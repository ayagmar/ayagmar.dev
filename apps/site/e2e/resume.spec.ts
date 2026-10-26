import { execFileSync } from 'node:child_process';
import { generatedResume, readAbout } from '../scripts/ship-resume.ts';
import { expect, test } from './fixtures.ts';

const about = readAbout();

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

test('the generated resume names the owner and every role', () => {
  let text: string;
  try {
    text = execFileSync('pdftotext', [generatedResume, '-'], { encoding: 'utf8' });
  } catch (error) {
    // pdftotext (poppler-utils) is optional locally and required in CI.
    const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
    test.skip(missing && !process.env.CI, 'pdftotext is not installed');
    throw error;
  }
  const flat = text.replace(/\s+/g, ' ');
  for (const line of [
    about.identity.name,
    ...about.experience.map((role) => `${role.role}, ${role.company}`),
  ]) {
    expect(flat).toContain(line);
  }
});
