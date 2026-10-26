import type { Skill, SkillsFile } from './skills-schema.ts';
import { type Post, postsByTag, tagPath } from './writing.ts';

/** The tag posts about skills carry; the shelf links its page when a published post has it. */
const skillsTag = 'skills';

export const commitUrl = (source: SkillsFile['source']) =>
  `https://github.com/${source.repo}/commit/${source.commit}`;

/** Posts tagged with the skill's name, in the order given. */
export const postsMentioning = <P extends Post>(posts: readonly P[], skill: Skill): P[] =>
  posts.filter((post) => post.data.tags.includes(skill.name));

/** The tag page for posts about skills, or null while no published post has the tag. */
export const skillsTagPath = (posts: readonly Post[]) =>
  postsByTag(posts).has(skillsTag) ? tagPath(skillsTag) : null;

export interface EvalLine {
  /** `3/3`: cases passed over cases run. */
  ratio: string;
  /** Whether every case passed. */
  clean: boolean;
  cases: string;
  passMark: string;
  ran: string;
}

/** The eval result as a compact ratio and as words, for the detail it opens. */
export function evalLine(skill: Skill): EvalLine | null {
  const result = skill.eval;
  if (result === null) return null;
  const same = result.version === skill.version;
  return {
    ratio: `${result.passed}/${result.total}`,
    clean: result.passed === result.total,
    cases: `${result.passed} of ${result.total} cases passed`,
    passMark: `pass mark ${Math.round(result.threshold * 100)}%`,
    ran: `${result.date}, ${result.model}, skill ${result.version}${same ? '' : ` (now ${skill.version})`}`,
  };
}

/** Whether the skill runs a program besides the agent reading it. */
export const needsNode = (skill: Skill) => skill.runtime !== null && /node/i.test(skill.runtime);

interface Shelf {
  title: string;
  blurb: string;
  skills: Skill[];
}

const shelves = [
  {
    title: 'Plan',
    blurb: 'From an idea to a spec, a plan, and a plan that has been attacked.',
    names: ['product-spec-foundry', 'implementation-plan-author', 'adversarial-plan-approval'],
  },
  {
    title: 'Review',
    blurb: 'Find what is wrong, say whether it ships, make it faster.',
    names: ['improve', 'release-readiness-certification', 'engineering-optimization'],
  },
  {
    title: 'Delegate and ship',
    blurb: 'Hand work out and check it came back right; commit without losing anything.',
    names: ['advisor-executor-quality-loop', 'commit'],
  },
  {
    title: 'Write',
    blurb: 'Words that read like a person wrote them.',
    names: ['no-slop', 'x-post-craft'],
  },
  {
    title: 'Read and recall',
    blurb: 'Pull in a page, or what earlier agent sessions said and cost.',
    names: ['summarize', 'session-memory-search', 'session-cost-forensics'],
  },
] as const;

/**
 * The skills sorted onto the shelves above. A skill the sync brought that no shelf names goes
 * on a last shelf instead of vanishing; the unit test fails until it is placed.
 */
export function shelvesOf(skills: readonly Skill[]): Shelf[] {
  const named = new Set<string>(shelves.flatMap((shelf) => shelf.names));
  const placed: Shelf[] = shelves.map((shelf) => ({
    title: shelf.title,
    blurb: shelf.blurb,
    skills: shelf.names.flatMap((name) => skills.filter((skill) => skill.name === name)),
  }));
  const rest = skills.filter((skill) => !named.has(skill.name));
  if (rest.length > 0) placed.push({ title: 'More', blurb: 'Not sorted yet.', skills: rest });
  return placed.filter((shelf) => shelf.skills.length > 0);
}

/** The install line with the skill and the agent left open, from the first skill that has one. */
export function installPattern(skills: readonly Skill[]): string | null {
  const first = skills.find((skill) => skill.install !== null);
  return (
    first?.install
      ?.replace(`--skill ${first.name}`, '--skill <name>')
      .replace(/--agent \S+/, '--agent <agent>') ?? null
  );
}

export interface CreditPart {
  text: string;
  href?: string;
}

/** A credit line with its web addresses split out, so the page can link them. */
export function creditParts(credit: string): CreditPart[] {
  return credit
    .split(/(https:\/\/[^\s)]+)/)
    .filter((part) => part !== '')
    .map((part) => (part.startsWith('https://') ? { text: part, href: part } : { text: part }));
}
