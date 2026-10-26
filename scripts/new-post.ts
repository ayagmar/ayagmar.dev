// Creates content/writing/<slug>.md as a draft. Usage: just post "Title of the post"
import { existsSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const title = process.argv.slice(2).join(' ').trim();
if (title === '') {
  console.error('Usage: just post "Title of the post"');
  process.exit(1);
}

const slug = title
  .normalize('NFKD')
  .replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');
if (slug === '') {
  console.error(`Cannot make a file name from "${title}"; use some letters or digits.`);
  process.exit(1);
}

const file = join(import.meta.dirname, '..', 'content', 'writing', `${slug}.md`);
if (existsSync(file)) {
  console.error(`${relative(process.cwd(), file)} already exists.`);
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);
writeFileSync(
  file,
  `---
title: ${JSON.stringify(title)}
date: ${today}
summary: 'TODO: one sentence on what this post is about.'
tags: []
draft: true
---

Write here.
`
);
console.log(`Created ${relative(process.cwd(), file)}. Set draft: false when it is ready.`);
