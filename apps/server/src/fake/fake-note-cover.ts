import { parsePrKey, type PrKey } from '@postpile/core';
import { SAMPLE_REPO, SampleClock, samplePr, sampleRepo } from './sample-builders.ts';
import type { SampleData } from './sample-data.ts';

/** A covering PR with this number takes longer to "read" than a note waits, once: note_pr answers pending, a retry finds it. */
export const SLOW_COVER_NUMBER = 1777;
/** How long a note waits for its covering PR on sample data (the engine waits 12 s). */
export const FAKE_COVER_WAIT_MS = 1500;
const SLOW_READ_MS = 3000;
/** Numbers from here up are PRs "GitHub" does not have. */
const MISSING_FROM = 90000;

/**
 * Whether the sample's stand-in for GitHub answers for this covering PR:
 * acme/app#1000 to #1999 exist (outside the sample, like a stack's parent
 * nobody pinged the user about), #90000 and up do not. Every other PR
 * outside the sample is refused before any "read", as before. Numbers
 * the sample gives another repo (#1915 is acme/infra) count as outside.
 */
export function fakeGitHubKnows(key: PrKey): boolean {
  const ref = parsePrKey(key);
  const inRange = (ref.number >= 1000 && ref.number <= 1999) || ref.number >= MISSING_FROM;
  return ref.repo === SAMPLE_REPO && sampleRepo(ref.number) === SAMPLE_REPO && inRange;
}

/**
 * The sample's stand-in for `GitHubSync.pullInCover`: stores the covering
 * PR as a pulled-in PR (in the sample's PRs, with no tile and no topic) or
 * says GitHub has none. Runs behind the engine's own NoteCoverReader, so
 * the hourly cap, the quota and the pending answer are the real ones.
 */
export class FakeNoteCover {
  private slowReadDone = false;

  constructor(
    private readonly data: SampleData,
    private readonly now: () => Date,
    private readonly markFetched: (key: PrKey) => void,
  ) {}

  async read(cover: PrKey, notedKey: PrKey): Promise<'stored' | 'not_found'> {
    const ref = parsePrKey(cover);
    if (ref.number >= MISSING_FROM) {
      return 'not_found';
    }
    if (ref.number === SLOW_COVER_NUMBER && !this.slowReadDone) {
      this.slowReadDone = true;
      await new Promise((resolve) => setTimeout(resolve, SLOW_READ_MS));
    }
    if (!this.data.prs.some((pr) => pr.key === cover)) {
      this.data.prs.push(
        samplePr(new SampleClock(this.now()), {
          number: ref.number,
          title: `Groundwork that #${parsePrKey(notedKey).number} builds on`,
          author: 'ines',
          state: 'OPEN',
          size: [40, 12, 3],
          openedHoursAgo: 96,
        }),
      );
    }
    this.markFetched(cover);
    return 'stored';
  }
}
