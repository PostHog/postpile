import { at, makePr, makeReview } from '@postpile/core/fixtures';
import { snapshotCoversSince, type Pr } from '@postpile/core';
import { describe, expect, it } from 'vitest';
import { GitHubClient } from './client.ts';
import { FakeFetch, fakeTokens } from './fake-fetch.ts';
import type { RawReview, RawReviewThread } from './raw.ts';

// A bot-heavy PR: the query kept the newest 50 reviews (from minute 40 on) and the newest 50
// threads; the viewer last read it at minute 20, so neither list reaches back to the read.
function cappedPr(): Pr {
  return makePr({
    number: 9,
    reviews: [makeReview({ id: 'R-kept', author: 'review-bot[bot]', state: 'COMMENTED', submittedAt: at(40) })],
    truncated: true,
    capHits: [
      { list: 'reviews', nodes: 50, oldestAt: at(40), cursor: 'reviews-50' },
      { list: 'review_threads', nodes: 50, oldestAt: null, cursor: 'threads-50' },
    ],
  });
}

function rawReview(id: string, minute: number, author = 'review-bot'): RawReview {
  return { id, author: { __typename: 'Bot', login: author }, state: 'COMMENTED', body: '', url: `https://github.com/acme/app/pull/9#${id}`, submittedAt: at(minute), createdAt: at(minute), commit: null };
}

function rawThread(id: string, minute: number): RawReviewThread {
  const comment = { id: `${id}-c`, author: { __typename: 'Bot', login: 'review-bot' }, body: 'nit', createdAt: at(minute), url: `https://github.com/acme/app/pull/9#${id}`, state: 'SUBMITTED' };
  return { id, path: 'src/app.ts', isResolved: false, comments: { totalCount: 1, pageInfo: { hasNextPage: false, endCursor: null }, nodes: [comment] } };
}

function page<T>(nodes: T[], hasPreviousPage: boolean, startCursor: string) {
  return { body: { data: { repository: { pullRequest: { page: { pageInfo: { hasPreviousPage, startCursor }, nodes } } } } } };
}

describe('fillCappedLists', () => {
  it('pages each capped list back with before cursors until it reaches the read, without repeats', async () => {
    const fake = new FakeFetch([
      // Reviews before "reviews-50": still after the read, and one repeat of a kept review.
      page([rawReview('R-30', 30), rawReview('R-kept', 40)], true, 'reviews-100'),
      // Reviews before "reviews-100": reaches back past the read at minute 20.
      page([rawReview('R-10', 10), rawReview('R-25', 25, 'alice')], true, 'reviews-150'),
      // The one older page of threads: GitHub has none before it.
      page([rawThread('RT-old', 15)], false, 'threads-51'),
    ]);
    const client = new GitHubClient(fakeTokens, fake.fn);

    const fill = await client.fillCappedLists(cappedPr(), at(20), 5);

    const cursors = fake.requests.map((request) => (request.body as { variables: { cursor: string } }).variables.cursor);
    expect(cursors).toEqual(['reviews-50', 'reviews-100', 'threads-50']);
    expect(fill.pages).toBe(3);
    expect(fill.pr.reviews.map((review) => review.id)).toEqual(['R-10', 'R-25', 'R-30', 'R-kept']);
    expect(fill.pr.reviews.find((review) => review.id === 'R-30')?.author).toBe('review-bot[bot]');
    expect(fill.pr.threads.map((thread) => thread.id)).toEqual(['RT-old']);
    expect(fill.pr.comments.map((comment) => comment.id)).toEqual(['RT-old-c']);
    expect(fill.pr.capHits).toEqual([
      { list: 'reviews', nodes: 54, oldestAt: at(10), cursor: 'reviews-150', complete: false },
      { list: 'review_threads', nodes: 51, oldestAt: null, cursor: 'threads-51', complete: true },
    ]);
  });

  it('stops at the page limit, and pages no other list once one stays short of the read', async () => {
    const fake = new FakeFetch([page([rawReview('R-30', 30)], true, 'reviews-100')]);

    const fill = await new GitHubClient(fakeTokens, fake.fn).fillCappedLists(cappedPr(), at(20), 1);

    expect(fake.requests).toHaveLength(1);
    expect(fill.pages).toBe(1);
    expect(fill.pr.capHits).toEqual([
      { list: 'reviews', nodes: 51, oldestAt: at(30), cursor: 'reviews-100', complete: false },
      { list: 'review_threads', nodes: 50, oldestAt: null, cursor: 'threads-50' },
    ]);
  });

  it('pages only the threads when the kept reviews already reach back to the read, and the snapshot then covers it', async () => {
    // A merged PR read at minute 50, a deploy bot's comment edit after: the 50 kept reviews start at minute 40,
    // before the read, but threads carry no time, so they cover only once paged to the end.
    const pr = cappedPr();
    const fake = new FakeFetch([page([rawThread('RT-old', 15)], false, 'threads-51')]);

    const fill = await new GitHubClient(fakeTokens, fake.fn).fillCappedLists(pr, at(50), 5);

    expect(snapshotCoversSince(pr, at(50))).toBe(false);
    expect(fake.requests.map((request) => (request.body as { variables: { cursor: string } }).variables.cursor)).toEqual(['threads-50']);
    expect(snapshotCoversSince(fill.pr, at(50))).toBe(true);
  });
});
