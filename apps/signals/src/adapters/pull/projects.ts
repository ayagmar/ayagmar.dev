// GitHub repository metadata and npm monthly downloads for the featured projects.
import {
  featuredProjects,
  githubReleaseSchema,
  githubRepoSchema,
  npmDownloadsSchema,
  type Project,
  type ProjectsSnapshot,
  projectsSnapshotSchema,
} from '@min7/contracts';
import type { PullAdapter } from '../types.ts';
import {
  checkSnapshot,
  getOptionalJson,
  orNull,
  PullError,
  parseBody,
  type UpstreamResponse,
} from './http.ts';
import { readSecret } from './secrets.ts';

// A repository is about 6 KiB, a release with long notes can reach 100 KiB.
const maxBytes = 256 * 1024;

/** Answers per featured repository and npm package; null is a failed request. */
export interface ProjectsRaw {
  github: Record<string, { repo: UpstreamResponse | null; release: UpstreamResponse | null }>;
  npm: Record<string, UpstreamResponse | null>;
}

export const projects: PullAdapter<ProjectsRaw, ProjectsSnapshot> = {
  id: 'projects',
  intervalSeconds: 24 * 60 * 60,

  async fetch(env, signal) {
    // Public data only. The token, when set, just raises GitHub's rate limit; it goes to
    // api.github.com and nowhere else.
    const token = readSecret(env, 'GITHUB_TOKEN');
    const github = {
      signal,
      maxBytes,
      headers: {
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      },
    };
    const npm = { signal, maxBytes };
    const answers = await Promise.all(
      featuredProjects.map(async (project) => {
        const { repo } = project;
        const npmPackage = 'npmPackage' in project ? project.npmPackage : undefined;
        const [metadata, release, downloads] = await Promise.all([
          getOptionalJson(`https://api.github.com/repos/${repo}`, github),
          getOptionalJson(`https://api.github.com/repos/${repo}/releases/latest`, github),
          npmPackage === undefined
            ? null
            : getOptionalJson(
                `https://api.npmjs.org/downloads/point/last-month/${npmPackage}`,
                npm
              ),
        ]);
        return { repo, npmPackage, metadata, release, downloads };
      })
    );
    const raw: ProjectsRaw = { github: {}, npm: {} };
    for (const { repo, npmPackage, metadata, release, downloads } of answers) {
      raw.github[repo] = { repo: metadata, release };
      if (npmPackage !== undefined) raw.npm[npmPackage] = downloads;
    }
    return raw;
  },

  normalize(raw) {
    const list: Project[] = [];
    const failures: PullError[] = [];
    for (const project of featuredProjects) {
      const { slug, repo } = project;
      const npmPackage = 'npmPackage' in project ? project.npmPackage : undefined;
      const answers = raw.github[repo];
      const metadata = readRepo(answers?.repo ?? null);
      if (metadata instanceof PullError) failures.push(metadata);
      // Deleted or private: not shown.
      if (metadata === 'gone') continue;
      const release = orNull(() => parseBody(required(answers?.release), githubReleaseSchema));
      const known = metadata instanceof PullError ? null : metadata;
      list.push({
        slug,
        repo: known?.full_name ?? repo,
        name: known?.name ?? repo.slice(repo.indexOf('/') + 1),
        url: known?.html_url ?? `https://github.com/${repo}`,
        description: known?.description ?? null,
        language: known?.language ?? null,
        stars: known?.stargazers_count ?? null,
        archived: known?.archived ?? null,
        latestRelease:
          release === null || release.published_at === null
            ? null
            : { tag: release.tag_name, url: release.html_url, publishedAt: release.published_at },
        npm:
          npmPackage === undefined
            ? null
            : {
                package: npmPackage,
                monthlyDownloads: downloadsOf(raw.npm[npmPackage], npmPackage),
              },
      });
    }
    // GitHub answered for no repository at all: the whole source failed.
    const [first] = failures;
    if (first !== undefined && failures.length === featuredProjects.length) throw first;
    return checkSnapshot(projectsSnapshotSchema, { projects: list });
  },
};

const required = (response: UpstreamResponse | null | undefined) => {
  if (response == null) throw new PullError('upstream_unreachable');
  return response;
};

function readRepo(response: UpstreamResponse | null) {
  if (response?.status === 404) return 'gone';
  try {
    const repo = parseBody(required(response), githubRepoSchema);
    return repo.private ? 'gone' : repo;
  } catch (error) {
    if (error instanceof PullError) return error;
    throw error;
  }
}

function downloadsOf(response: UpstreamResponse | null | undefined, npmPackage: string) {
  const parsed = orNull(() => parseBody(required(response), npmDownloadsSchema));
  return parsed !== null && parsed.package === npmPackage ? parsed.downloads : null;
}
