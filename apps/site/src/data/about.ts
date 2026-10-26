import { z } from 'astro/zod';

const text = z.string({ error: 'is required' }).trim().min(1, 'must not be empty');
const url = z.url({ protocol: /^https$/, error: 'must be an https:// URL' });
// Month precision is all a resume shows; the Typst template parses the same format.
const month = z
  .string({ error: 'must be a month like 2025-05' })
  .regex(/^\d{4}-(?:0[1-9]|1[0-2])$/, 'must be a month like 2025-05');

const endAfterStart = <T extends { start: string; end?: string | null }>(entry: T) =>
  entry.end === null || entry.end === undefined || entry.end >= entry.start;
// Order checks run only on otherwise valid values, so a malformed month reports just that.
const valid = { when: (payload: { issues: readonly unknown[] }) => payload.issues.length === 0 };
const endMessage = { ...valid, path: ['end'], message: 'must not be before start' };

/** content/about.json: the about page and the resume PDF. Unknown fields are rejected to catch typos. */
export const aboutSchema = z.strictObject({
  identity: z.strictObject({
    name: text,
    role: text,
    location: text,
    links: z.strictObject({ site: url, github: url, linkedin: url, x: url, lastfm: url }),
  }),
  summary: text,
  /** Newest first. `end: null` is the current role. */
  experience: z
    .array(
      z
        .strictObject({
          role: text,
          company: text,
          place: text,
          start: month,
          end: month.nullable(),
          outcomes: z.array(text).max(3, 'must list at most 3 outcomes'),
        })
        .refine(endAfterStart, endMessage)
    )
    .min(1, 'must list at least one role')
    .refine(
      (roles) => roles.every((role, i) => i === 0 || role.start <= (roles[i - 1]?.start ?? '')),
      { ...valid, message: 'must be newest first' }
    ),
  certifications: z.array(
    z
      .strictObject({
        name: text,
        issuer: text,
        issued: month,
        expires: month.optional(),
        credentialId: text.optional(),
        verifyUrl: url,
      })
      .refine((cert) => cert.expires === undefined || cert.expires >= cert.issued, {
        ...valid,
        path: ['expires'],
        message: 'must not be before issued',
      })
  ),
  education: z.array(
    z
      .strictObject({
        school: text,
        degree: text,
        field: text.optional(),
        start: month,
        end: month,
      })
      .refine(endAfterStart, endMessage)
  ),
  skills: z.array(text).min(1, 'must list at least one skill'),
  resume: z.strictObject({
    /** false: the page says the PDF is coming soon and the build does not ship it. */
    published: z.boolean({ error: 'must be true or false' }),
  }),
});

export type About = z.output<typeof aboutSchema>;

/** Validates about data, throwing an error that names every bad field. */
export function parseAbout(data: unknown, source = 'content/about.json'): About {
  const result = aboutSchema.safeParse(data);
  if (!result.success) {
    throw new Error(`${source} is invalid:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

/** The public path of the resume PDF when it is published. */
export const resumePath = '/resume.pdf';

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2025-05" as "May 2025". resume/resume.typ formats months the same way. */
export function formatMonth(value: string): string {
  const [year, monthNumber] = value.split('-');
  return `${months[Number(monthNumber) - 1]} ${year}`;
}
