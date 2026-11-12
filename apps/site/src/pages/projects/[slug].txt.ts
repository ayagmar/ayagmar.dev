import type { APIRoute, GetStaticPaths } from 'astro';
import { signals } from '../../data/signals.ts';
import { projectReceipt } from '../../lib/days.ts';
import { renderProjectText, textFile } from '../../lib/plaintext.ts';
import { getDays, getPosts, getProjects } from '../../lib/posts.ts';
import { projectEvents } from '../../lib/project-panel.ts';
import { hasReleased, nextProject, postsAbout } from '../../lib/projects.ts';

export const getStaticPaths = (async () => {
  const posts = await getPosts();
  const { projects } = await getProjects();
  const { history } = await getDays();
  const logs = await signals.read('project-events');
  return projects.map((project) => ({
    params: { slug: project.slug },
    props: {
      text: renderProjectText(project, {
        posts: postsAbout(posts, project.slug),
        description: project.file?.body,
        shipped: projectEvents(logs.data, project.slug),
        released: hasReleased(project, logs.data),
        receipt: projectReceipt(history, project.repo),
        next: nextProject(projects, project.slug),
      }),
    },
  }));
}) satisfies GetStaticPaths;

export const GET: APIRoute<{ text: string }> = ({ props }) => textFile(props.text);
