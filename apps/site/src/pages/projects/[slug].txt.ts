import type { APIRoute, GetStaticPaths } from 'astro';
import { signals } from '../../data/signals.ts';
import { renderProjectText, textFile } from '../../lib/plaintext.ts';
import { getPosts, getProjects } from '../../lib/posts.ts';
import { postsAbout } from '../../lib/projects.ts';

export const getStaticPaths = (async () => {
  const posts = await getPosts();
  const { projects } = await getProjects();
  const shipping = await signals.read('shipping');
  return projects.map((project) => ({
    params: { slug: project.slug },
    props: {
      text: renderProjectText(
        project,
        postsAbout(posts, project.slug),
        project.file?.body,
        shipping.data?.events ?? []
      ),
    },
  }));
}) satisfies GetStaticPaths;

export const GET: APIRoute<{ text: string }> = ({ props }) => textFile(props.text);
