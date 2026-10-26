import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dirname, '..', '..', '..', 'content', 'til');

/** Every note in content/til: its slug, title, date and whether its frontmatter says `draft: true`. */
export const notes = readdirSync(dir)
  .filter((file) => file.endsWith('.md'))
  .map((file) => {
    const text = readFileSync(join(dir, file), 'utf8');
    const front = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? '';
    return {
      slug: file.replace(/\.md$/, ''),
      title: /^title:\s*(.+?)\s*$/m.exec(front)?.[1] ?? '',
      date: /^date:\s*(\S+)/m.exec(front)?.[1] ?? '',
      draft: /^draft:\s*true\s*$/m.test(front),
    };
  });
