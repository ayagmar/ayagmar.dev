import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import ResumeDownload from '../src/components/ResumeDownload.astro';

const render = async (published: boolean) =>
  (await AstroContainer.create()).renderToString(ResumeDownload, { props: { published } });

describe('resume download', () => {
  it('links the PDF once published', async () => {
    const html = await render(true);
    expect(html).toMatch(/<a href="\/resume.pdf"[^>]*>Resume \(PDF\)<\/a>/);
  });

  it('is a disabled, explained placeholder until then', async () => {
    const html = await render(false);
    expect(html).not.toContain('href=');
    expect(html).toMatch(
      /<button type="button" aria-disabled="true"[^>]*>\s*Resume PDF: coming soon\s*<\/button>/
    );
    expect(html).toContain('not available to download yet');
  });
});
