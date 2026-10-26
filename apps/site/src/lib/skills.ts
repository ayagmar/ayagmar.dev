import type { Skill, SkillsFile } from './skills-schema.ts';
import { type Post, postsByTag, tagPath } from './writing.ts';

export const skillsPath = '/skills';
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
  /** Passed cases first, then failed ones, for the row of marks. */
  marks: boolean[];
  cases: string;
  passMark: string;
  ran: string;
}

/** The eval summary as words, so the row of marks is never the only statement of the result. */
export function evalLine(skill: Skill): EvalLine | null {
  const result = skill.eval;
  if (result === null) return null;
  const same = result.version === skill.version;
  return {
    marks: Array.from({ length: result.total }, (_, index) => index < result.passed),
    cases: `${result.passed} of ${result.total} cases passed`,
    passMark: `pass mark ${Math.round(result.threshold * 100)}%`,
    ran: `${result.date}, ${result.model}, skill ${result.version}${same ? '' : ` (now ${skill.version})`}`,
  };
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
