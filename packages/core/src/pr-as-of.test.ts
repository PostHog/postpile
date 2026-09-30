import { describe, expect, it } from 'vitest';
import { at, makeComment, makeCommit, makeEvent, makePr, makeReview, makeThread, makeTimelineItem, makeUserState } from './fixtures.ts';
import { eventsAsOf, prAsOf, userStateAsOf } from './pr-as-of.ts';

describe('prAsOf', () => {
  it('takes out reviews, comments, commits and timeline items added after the time', () => {
    const pr = makePr({
      reviews: [makeReview({ id: 'r1', submittedAt: at(10) }), makeReview({ id: 'r2', submittedAt: at(30) })],
      comments: [makeComment({ id: 'c1', createdAt: at(10) }), makeComment({ id: 'c2', createdAt: at(30) })],
      threads: [makeThread('t1', [makeComment({ id: 'i1', createdAt: at(10) }), makeComment({ id: 'i2', createdAt: at(30) })]), makeThread('t2', [makeComment({ id: 'i3', createdAt: at(30) })])],
      commits: [makeCommit({ oid: 'a', committedAt: at(5) }), makeCommit({ oid: 'b', committedAt: at(30) })],
      headOid: 'b',
      timeline: [makeTimelineItem({ id: 'x', at: at(5) }), makeTimelineItem({ id: 'y', at: at(30) })],
    });
    const then = prAsOf(pr, at(20));
    expect(then.reviews.map((review) => review.id)).toEqual(['r1']);
    expect(then.comments.map((comment) => comment.id)).toEqual(['c1']);
    expect(then.threads.map((thread) => [thread.id, thread.comments.map((comment) => comment.id)])).toEqual([['t1', ['i1']]]);
    expect([then.commits.map((commit) => commit.oid), then.headOid]).toEqual([['a'], 'a']);
    expect(then.timeline.map((item) => item.id)).toEqual(['x']);
  });

  it('drops a pending request asked only after the time, keeps one asked before or never seen asked', () => {
    const pr = makePr({
      reviewerUsers: ['viewer', 'bob', 'carol'],
      reviewerTeams: ['acme/team-platform'],
      timeline: [
        makeTimelineItem({ id: 'r1', subject: 'viewer', at: at(5) }),
        makeTimelineItem({ id: 'r2', subject: 'viewer', at: at(30) }),
        makeTimelineItem({ id: 'r3', subject: 'bob', at: at(5) }),
        makeTimelineItem({ id: 'r4', subject: 'acme/team-platform', at: at(30) }),
      ],
    });
    const then = prAsOf(pr, at(20));
    expect(then.reviewerUsers).toEqual(['bob', 'carol']);
    expect(then.reviewerTeams).toEqual([]);
  });

  it('does not put back what was taken away after the time: a removed request stays gone', () => {
    const pr = makePr({ reviewerTeams: [], timeline: [makeTimelineItem({ id: 'rm', kind: 'review_request_removed', subject: 'acme/team-infra', at: at(30) })] });
    expect(prAsOf(pr, at(20)).reviewerTeams).toEqual([]);
  });

  it('reads the draft state from the first switch after the time', () => {
    const readied = makePr({ isDraft: false, timeline: [makeTimelineItem({ id: 'rd', kind: 'ready_for_review', subject: null, at: at(30) })] });
    expect(prAsOf(readied, at(20)).isDraft).toBe(true);
    const drafted = makePr({ isDraft: true, timeline: [makeTimelineItem({ id: 'dr', kind: 'converted_to_draft', subject: null, at: at(30) })] });
    expect(prAsOf(drafted, at(20)).isDraft).toBe(false);
    expect(prAsOf(drafted, at(40)).isDraft).toBe(true);
  });

  it('works the review decision out again only when a review came after the time', () => {
    const approvedLater = makePr({ reviewDecision: 'APPROVED', reviews: [makeReview({ state: 'APPROVED', submittedAt: at(30) })] });
    expect(prAsOf(approvedLater, at(20)).reviewDecision).toBe('REVIEW_REQUIRED');
    expect(prAsOf(approvedLater, at(40)).reviewDecision).toBe('APPROVED');
    const noRule = makePr({ reviewDecision: 'NONE', reviews: [makeReview({ submittedAt: at(30) })] });
    expect(prAsOf(noRule, at(20)).reviewDecision).toBe('NONE');
  });
});

describe('eventsAsOf and userStateAsOf', () => {
  it('keeps events up to the time and an approval made by then', () => {
    expect(eventsAsOf([makeEvent({ id: 'a', at: at(10) }), makeEvent({ id: 'b', at: at(30) })], at(20)).map((event) => event.id)).toEqual(['a']);
    const approved = makeUserState({ approvedAt: at(30), approvedCommitOid: 'head' });
    expect(userStateAsOf(approved, at(20))).toMatchObject({ approvedAt: null, approvedCommitOid: null });
    expect(userStateAsOf(approved, at(40))).toBe(approved);
    expect(userStateAsOf(null, at(20))).toBeNull();
  });
});
