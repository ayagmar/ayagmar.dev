// The label beside each project's name on home and /projects, kept current in the browser as the
// project page keeps its numbers (ADR 0015, ADR 0051): a newer valid answer from signals redraws
// every row from the same rule the build used (src/lib/project-row.ts). A project the answer
// leaves out loses its fact rather than keep an older number under a newer answer. In fixtures
// mode the list has no endpoint and nothing is requested.

import type { ProjectsSnapshot } from '@min7/contracts';
import type { Answer } from '../lib/live.ts';
import { live } from '../lib/live-page.ts';
import { projectFact, rowLabel } from '../lib/project-row.ts';
import { readProjects } from '../lib/stats.ts';

// GitHub and npm are pulled every 6 hours; asking every half hour is soon enough.
live('projects', 30 * 60_000, readProjects, (list, answer: Answer<ProjectsSnapshot>) => {
  for (const row of list.querySelectorAll<HTMLElement>('[data-project-row]')) {
    const entry = answer.data.projects.find((project) => project.slug === row.dataset.projectRow);
    const words = rowLabel(projectFact(entry ?? null), row.dataset.rest ?? '');
    row.textContent = words;
    row.hidden = words === '';
  }
});
