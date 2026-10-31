import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const content = join(import.meta.dirname, '..', '..', '..', 'content');

/** Every entry in content/<dir>: its slug, title, date and whether its frontmatter says `draft: true`. */
function entries(dir: 'writing' | 'til') {
  return readdirSync(join(content, dir))
    .filter((file) => file.endsWith('.md'))
    .map((file) => {
      const text = readFileSync(join(content, dir, file), 'utf8');
      const front = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? '';
      return {
        slug: file.replace(/\.md$/, ''),
        title: (/^title:\s*(.+?)\s*$/m.exec(front)?.[1] ?? '').replace(/^(['"])(.*)\1$/, '$2'),
        date: /^date:\s*(\S+)/m.exec(front)?.[1] ?? '',
        draft: /^draft:\s*true\s*$/m.test(front),
      };
    });
}

export const posts = entries('writing');
export const notes = entries('til');
