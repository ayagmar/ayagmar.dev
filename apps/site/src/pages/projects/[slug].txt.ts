import type { APIRoute, GetStaticPaths } from 'astro';
import { renderProjectText, textFile } from '../../lib/plaintext.ts';
import { getPosts, getProjects } from '../../lib/posts.ts';
import { postsAbout } from '../../lib/projects.ts';

export const getStaticPaths = (async () => {
  const posts = await getPosts();
  const { projects } = await getProjects();
  return projects.map((project) => ({
    params: { slug: project.slug },
    props: {
      text: renderProjectText(project, postsAbout(posts, project.slug), project.file?.body),
    },
  }));
}) satisfies GetStaticPaths;

export const GET: APIRoute<{ text: string }> = ({ props }) => textFile(props.text);
