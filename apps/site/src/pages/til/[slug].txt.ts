import type { APIRoute, GetStaticPaths } from 'astro';
import { noteArticle, renderArticleText } from '../../lib/article.ts';
import { textFile } from '../../lib/plaintext.ts';
import { getNotes } from '../../lib/posts.ts';
import type { Note } from '../../lib/til.ts';

export const getStaticPaths = (async () =>
  (await getNotes()).map((note) => ({
    params: { slug: note.id },
    props: { note },
  }))) satisfies GetStaticPaths;

export const GET: APIRoute<{ note: Note }> = ({ props }) =>
  textFile(renderArticleText(noteArticle(props.note)));
