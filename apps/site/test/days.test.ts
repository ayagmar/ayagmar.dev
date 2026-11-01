// Day pages and receipts (src/lib/days.ts): which dates get a page, what each says, and what a
// project's or a post's receipt counts, from recorded days of both series and the writing.
import type { LlmUsageDay, ShippingActivityDay } from '@min7/contracts';
import { describe, expect, it } from 'vitest';
import {
  dayPages,
  type History,
  type Published,
  postReceipt,
  projectReceipt,
  projectRepos,
} from '../src/lib/days.ts';

const zero = { pushes: 0, commits: 0, merges: 0, releases: 0, stars: 0 };
type Repo = ShippingActivityDay['repos'][number];
const repo = (name: string, counts: Partial<typeof zero>): Repo => ({
  repo: name,
  ...zero,
  ...counts,
});
/** A shipping day (UTC) whose counts are its repositories' plus `hidden`, an unnamed one's. */
function shipped(date: string, repos: Repo[], hidden?: Partial<typeof zero>): ShippingActivityDay {
  const all = [...repos, repo('x/hidden', hidden ?? {})];
  const sum = (key: keyof typeof zero) => all.reduce((total, entry) => total + entry[key], 0);
  return {
    date,
    pushes: sum('pushes'),
    commits: sum('commits'),
    merges: sum('merges'),
    releases: sum('releases'),
    stars: sum('stars'),
    repos,
    reposComplete: hidden === undefined,
  };
}
const used = (date: string, totalTokens: number, activeMs?: number): LlmUsageDay => ({
  date,
  costUsd: null,
  totalTokens,
  ...(activeMs === undefined ? {} : { activeMs }),
});

const runnerd = 'ayagmar/runnerd';
const ccdesk = 'ayagmar/ccdesk';
const history: History = {
  shipping: [
    shipped('2026-10-24', [repo(runnerd, { merges: 2, pushes: 1, commits: 4 })]),
    shipped('2026-10-25', [repo(ccdesk, { merges: 1, releases: 1, stars: 3 })], { merges: 5 }),
    shipped('2026-10-26', []),
    // Starred, nothing pushed: the strip calls it nothing shipped, so must the page.
    shipped('2026-10-28', [repo(runnerd, { stars: 2 })]),
  ],
  // Work after midnight in Rabat on the 27th: still the 26th in UTC, never moved there.
  usage: [used('2026-10-25', 2_000_000, 3_600_000), used('2026-10-27', 640_000)],
};

describe('dayPages', () => {
  // Catches a series moved onto the other's calendar (a Rabat day shown under a UTC date) and
  // neighbours linked out of order across the two series.
  it('gives each date with a record its page, each series on its own calendar', () => {
    const pages = dayPages(history, []);
    expect(pages.map((page) => page.date)).toEqual([
      '2026-10-24',
      '2026-10-25',
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
    ]);
    const [first, both, quiet, rabatOnly, starred] = pages;
    expect(first?.previous).toBeNull();
    expect(first?.next).toEqual({ path: '/day/2026-10-25', title: '25 October 2026' });
    expect(starred?.next).toBeNull();
    expect(starred?.shipping).toEqual({ empty: 'Nothing shipped.' });

    expect(both).toMatchObject({
      title: '25 October 2026',
      shipping: {
        empty: null,
        total: '6 merges · 1 release',
        repos: [{ repo: ccdesk, counts: '1 merge · 1 release' }],
        unnamed: 'Some of it was in repositories not named here.',
      },
      usage: { empty: null, tokens: '2.0M tokens', time: '1 hour of agent time, estimated' },
    });
    // A recorded day with nothing shipped says so, unlike a date with no record.
    expect(quiet?.shipping).toEqual({ empty: 'Nothing shipped.' });
    expect(quiet?.usage).toEqual({ empty: 'No agent usage recorded for this date.' });
    expect(rabatOnly?.shipping).toEqual({ empty: 'No shipping recorded for this date.' });
    // No agent time sent is unknown, not zero.
    expect(rabatOnly?.usage).toEqual({ empty: null, tokens: '640.0K tokens', time: null });
  });

  // Catches a day page missing for a post published on a date neither history recorded, or a
  // series that could not be read whole showing as a quiet day.
  it('gives a date with only a post a page, and says what is not recorded', () => {
    const post: Published = {
      date: '2026-09-14',
      title: 'Ricing niri',
      path: '/writing/ricing-niri',
      kind: 'Post',
    };
    const [page, ...rest] = dayPages({ shipping: null, usage: null }, [post]);
    expect(rest).toEqual([]);
    expect(page).toMatchObject({
      date: '2026-09-14',
      shipping: { empty: 'Shipping history could not be read when this page was built.' },
      usage: { empty: 'Agent usage history could not be read when this page was built.' },
      published: [post],
      previous: null,
      next: null,
    });
    expect(dayPages({ shipping: null, usage: null }, [])).toEqual([]);
  });
});

describe('projectReceipt', () => {
  // Catches another repository's or an unnamed one's counts added to the project, and a
  // receipt dated from the project's first activity rather than from when recording began.
  it("counts the project's repository over every recorded day, since the first", () => {
    expect(projectReceipt(history, runnerd)).toBe(
      '2 merges · 4 commits · 0 releases since 24 Oct 2026'
    );
    expect(projectReceipt(history, ccdesk)).toBe(
      '1 merge · 0 commits · 1 release since 24 Oct 2026'
    );
    expect(projectReceipt({ shipping: null, usage: history.usage }, runnerd)).toBeNull();
  });
});

describe('postReceipt', () => {
  const range = { from: '2026-10-24', to: '2026-10-26' };

  // Catches the filter being ignored, the post's projects not used as the default, and a
  // repository filter dropping the unnamed repositories from an unfiltered count.
  it('counts the repositories asked for, else the post projects, else everything', () => {
    expect(postReceipt(history, { ...range, repos: [ccdesk] }, projectRepos(['runnerd']))).toBe(
      '24–26 Oct 2026, ccdesk: 1 PR merged · 0 commits · 2.0M agent tokens in all · 1 active day (some days have no record)'
    );
    expect(postReceipt(history, range, projectRepos(['runnerd']))).toBe(
      '24–26 Oct 2026, runnerd: 2 PRs merged · 4 commits · 2.0M agent tokens in all · 2 active days (some days have no record)'
    );
    // Everything includes the repository signals does not name.
    expect(postReceipt(history, range, [])).toBe(
      '24–26 Oct 2026: 8 PRs merged · 4 commits · 2.0M agent tokens · 2 active days (some days have no record)'
    );
  });

  // Catches a Rabat day counted under the UTC range it falls next to, and a series with no
  // record shown as zero rather than left out.
  it('counts each series by its own dates and leaves out a series it has no record of', () => {
    expect(postReceipt(history, { from: '2026-10-27', to: '2026-10-27' }, [])).toBe(
      '27 Oct 2026: 640.0K agent tokens · 1 active day (some days have no record)'
    );
    expect(postReceipt({ ...history, usage: null }, range, [])).toBe(
      '24–26 Oct 2026: 8 PRs merged · 4 commits · 2 active days (some days have no record)'
    );
    expect(postReceipt(history, { from: '2026-09-01', to: '2026-09-30' }, [])).toBeNull();
  });
});
