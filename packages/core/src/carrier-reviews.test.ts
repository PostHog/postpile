import { describe, expect, it } from 'vitest';
import { carriedReplies, commentsSentWith, isCarrierReview, isCarrierReviewEvent } from './carrier-reviews.ts';
import { deriveEvents } from './events.ts';
import { at, makeComment, makePr, makeReview, makeThread, viewer } from './fixtures.ts';
import { headlineClass } from './headline.ts';
import { prPaneView } from './pr-pane.ts';
import type { FullComment as Comment, FullPr as Pr, FullReview as Review } from './types.ts';

const me = viewer.login;

/** A PR whose threads are made of `comments` per thread id; every thread comment is also in `pr.comments`, like the reader. */
function prWith(threads: Record<string, Comment[]>, extra: Partial<Pr> = {}): Pr {
  const built = Object.entries(threads).map(([id, comments]) => makeThread(id, comments));
  const comments = [...(extra.comments ?? []), ...built.flatMap((thread) => thread.comments)].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return makePr({ ...extra, threads: built, comments });
}

/** A comment at `minute`; `reviewId` when the snapshot knows its review. */
function say(id: string, author: string, minute: number, body = 'ok', reviewId?: string): Comment {
  return makeComment({ id, author, body, createdAt: at(minute), ...(reviewId === undefined ? {} : { reviewId }) });
}

function empty(id: string, author: string, minute: number): Review {
  return makeReview({ id, author, state: 'COMMENTED', body: '', submittedAt: at(minute) });
}

const ids = (comments: Array<{ id: string }>) => comments.map((comment) => comment.id);

describe('carriedReplies', () => {
  it('matches the replies by review id, whatever their time', () => {
    const pr = prWith({ t1: [say('b1', 'bob', 1, 'why?', 'rb'), say('a1', 'alice', 5, 'because', 'ra')] }, { reviews: [empty('rb', 'bob', 1), empty('ra', 'alice', 9)] });
    expect(ids(carriedReplies(pr.reviews[1]!, pr))).toEqual(['a1']);
  });

  it('falls back to author and time for comments without a review id', () => {
    const pr = prWith({ t1: [say('b1', 'bob', 1, 'why?'), say('a1', 'alice', 5, 'because')] }, { reviews: [empty('ra', 'alice', 5), empty('rx', 'alice', 7)] });
    expect(ids(carriedReplies(pr.reviews[0]!, pr))).toEqual(['a1']);
    expect(carriedReplies(pr.reviews[1]!, pr)).toEqual([]);
  });

  it('never takes a comment that names another review by time', () => {
    const pr = prWith({ t1: [say('b1', 'bob', 1, 'why?'), say('a1', 'alice', 5, 'because', 'ra')] }, { reviews: [empty('ra', 'alice', 5), empty('rx', 'alice', 5)] });
    expect(ids(commentsSentWith(pr.reviews[1]!, pr))).toEqual([]);
    expect(isCarrierReview(pr.reviews[1]!, pr)).toBe(false);
  });

  it('reads a mix of old comments without a review id and new ones with it', () => {
    const pr = prWith(
      { t1: [say('b1', 'bob', 1, 'why?'), say('a1', 'alice', 5, 'because')], t2: [say('b2', 'bob', 6, 'and this?', 'rb2'), say('a2', 'alice', 9, 'same', 'ra2')] },
      { reviews: [empty('ra1', 'alice', 5), empty('rb2', 'bob', 6), empty('ra2', 'alice', 9)] },
    );
    expect(pr.reviews.map((review) => ids(carriedReplies(review, pr)))).toEqual([['a1'], [], ['a2']]);
  });

  it('keeps real reviews: a verdict, text, a review that opens threads, or one that opens and answers', () => {
    const pr = prWith(
      { t1: [say('b1', 'bob', 1, 'why?', 'r-open'), say('a1', 'alice', 5, 'because', 'r-text')], t2: [say('a2', 'alice', 6, 'new point', 'r-mixed')], t3: [say('b3', 'bob', 1, 'hm', 'r-open'), say('a3', 'alice', 6, 'yes', 'r-mixed')] },
      {
        reviews: [
          empty('r-open', 'bob', 1),
          makeReview({ id: 'r-text', author: 'alice', state: 'COMMENTED', body: 'see inline', submittedAt: at(5) }),
          empty('r-mixed', 'alice', 6),
          makeReview({ id: 'r-ok', author: 'alice', state: 'APPROVED', submittedAt: at(6) }),
        ],
      },
    );
    expect(pr.reviews.map((review) => isCarrierReview(review, pr))).toEqual([false, false, false, false]);
  });

  it('carries several replies in one review, and replies of the opener in their own thread', () => {
    const pr = prWith({ t1: [say('b1', 'bob', 1, 'why?'), say('a1', 'alice', 2, 'because', 'ra')], t2: [say('a2', 'alice', 3, 'note'), say('a3', 'alice', 4, 'more', 'ra')] }, { reviews: [empty('ra', 'alice', 4)] });
    expect(ids(carriedReplies(pr.reviews[0]!, pr))).toEqual(['a1', 'a3']);
  });
});

describe('carrier reviews on the tile side', () => {
  /** bob asks on the viewer's PR, alice (a teammate) answers him in the thread. */
  const pr = prWith({ t1: [say('b1', 'bob', 1, 'why the retry?', 'rb'), say('a1', 'alice', 5, 'flaky upload', 'ra')] }, { author: me, reviews: [empty('rb', 'bob', 1), empty('ra', 'alice', 5)] });

  it('is quiet on your PR: the reply is the news, not the wrapper', () => {
    const events = deriveEvents(pr, viewer, null);
    expect(events.find((event) => event.sourceId === 'ra')).toMatchObject({ kind: 'review_commented', ruleLoudness: 'quiet', ruleReason: 'only carries replies in review threads' });
    expect(events.find((event) => event.sourceId === 'a1')).toMatchObject({ ruleLoudness: 'loud', ruleReason: 'comment on your PR' });
    // The review bob opened the thread with is a real review on your PR.
    expect(events.find((event) => event.sourceId === 'rb')).toMatchObject({ ruleLoudness: 'loud', ruleReason: 'review on your PR' });
  });

  it('ranks below the reply in the headline', () => {
    const events = deriveEvents(pr, viewer, null);
    expect(headlineClass(events.find((event) => event.sourceId === 'ra')!, pr, viewer)).toBe(4);
    expect(headlineClass(events.find((event) => event.sourceId === 'a1')!, pr, viewer)).toBe(3);
    expect(isCarrierReviewEvent({ kind: 'review_commented', sourceId: 'ra' }, pr)).toBe(true);
    expect(isCarrierReviewEvent({ kind: 'review_commented', sourceId: 'rb' }, pr)).toBe(false);
  });

  it('does not answer your changes request; the reply does', () => {
    const theirs = prWith(
      { t1: [say('v1', me, 10, 'please split', 'rv'), say('a1', 'alice', 20, 'split it', 'ra')] },
      { author: 'alice', reviews: [makeReview({ id: 'rv', author: me, state: 'CHANGES_REQUESTED', body: '', submittedAt: at(10) }), empty('ra', 'alice', 20)] },
    );
    const events = deriveEvents(theirs, viewer, null);
    expect(events.find((event) => event.sourceId === 'ra')?.ruleLoudness).toBe('quiet');
    expect(events.find((event) => event.sourceId === 'a1')?.ruleLoudness).toBe('loud');
  });

  it("leaves the pane's Reviews list", () => {
    expect(prPaneView(pr).reviews.map((review) => review.author)).toEqual(['bob']);
  });
});
