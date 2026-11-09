import { describe, expect, it } from 'vitest';
import { branchEntry, branchesView, pushesSinceYourReview, readyToLand, repliesSinceYourReview } from './branches.ts';
import { at, makeComment, makeCommit, makePr, makeReview, makeThread, makeTimelineItem, viewer } from './fixtures.ts';
import type { FullPr } from './types.ts';

const me = viewer.login;

function input(pr: FullPr) {
  return { pr, events: [], userState: null, fetchedAt: at(100) };
}

describe('branchEntry', () => {
  it('lists own PRs as author with join keys and the title under untrusted', () => {
    const entry = branchEntry(input(makePr({ author: me, headRef: 'feat/x', baseRef: 'main' })), viewer);
    expect(entry).toMatchObject({ key: 'acme/app#1', repo: 'acme/app', number: 1, headRef: 'feat/x', baseRef: 'main', role: 'author', state: 'open', untrusted: { title: 'PR 1' } });
    expect(entry?.signals.pushesSinceYourReview).toBeNull();
  });

  it('lists PRs the viewer reviewed in any way as reviewer, and skips the rest', () => {
    const commented = makePr({ reviews: [makeReview({ author: me, state: 'COMMENTED' })] });
    expect(branchEntry(input(commented), viewer)?.role).toBe('reviewer');
    const pending = makePr({ reviews: [makeReview({ author: me, state: 'PENDING' })] });
    expect(branchEntry(input(pending), viewer)).toBeNull();
    expect(branchEntry(input(makePr()), viewer)).toBeNull();
  });

  it('says whose move it is with the existing rule', () => {
    const approved = makePr({ author: me, reviewDecision: 'APPROVED', reviews: [makeReview({ author: 'bob' })] });
    expect(branchEntry(input(approved), viewer)?.whoseMove).toMatchObject({ kind: 'you', move: 'merge' });
  });

  it('collects feedback on own PRs: change requests, waiting threads, a stamphog decline', () => {
    const pr = makePr({
      author: me,
      reviewDecision: 'CHANGES_REQUESTED',
      reviews: [makeReview({ author: 'bob', state: 'CHANGES_REQUESTED', submittedAt: at(20) })],
      threads: [makeThread('t1', [makeComment({ author: 'mira', createdAt: at(30), url: 'https://github.com/acme/app/pull/1#r1' })])],
    });
    const feedback = branchEntry(input(pr), viewer)?.signals.feedback;
    expect(feedback).toEqual({
      changesRequested: [{ by: 'bob', at: at(20) }],
      changesNext: 'address',
      unansweredThreads: 1,
      newestUnansweredThread: { author: 'mira', at: at(30), path: 'a.ts', url: 'https://github.com/acme/app/pull/1#r1' },
      botDecline: null,
    });
    expect(branchEntry(input(makePr({ author: me })), viewer)?.signals.feedback).toBeNull();
  });

  it('reads a stamphog decline with olderHead', () => {
    const decline = makeReview({ author: 'stamphog[bot]', state: 'COMMENTED', body: '**Not approved**\n\nNeeds a person.', commitOid: 'old' });
    const pr = makePr({ author: me, reviews: [decline] });
    expect(branchEntry(input(pr), viewer)?.signals.feedback?.botDecline).toMatchObject({ agent: 'stamphog', kind: 'needs_person', olderHead: true });
  });

  it('says when the PR ended', () => {
    const merged = makePr({ author: me, state: 'MERGED', mergedAt: at(50) });
    expect(branchEntry(input(merged), viewer)?.signals.ended).toEqual({ state: 'merged', at: at(50) });
    const closed = makePr({ author: me, state: 'CLOSED', updatedAt: at(70), timeline: [makeTimelineItem({ kind: 'closed', at: at(60) })] });
    expect(branchEntry(input(closed), viewer)).toMatchObject({ closedAt: at(60), signals: { ended: { state: 'closed', at: at(60) } } });
  });
});

describe('readyToLand', () => {
  const approved = { author: me, reviewDecision: 'APPROVED' as const, reviews: [makeReview({ author: 'bob' })] };

  it('is true once approved with nothing holding it', () => {
    expect(readyToLand(makePr(approved), viewer)).toBe(true);
  });

  it('is false on drafts, closed PRs, unapproved PRs and waiting threads', () => {
    expect(readyToLand(makePr({ ...approved, isDraft: true }), viewer)).toBe(false);
    expect(readyToLand(makePr({ ...approved, state: 'MERGED' }), viewer)).toBe(false);
    expect(readyToLand(makePr({ author: me }), viewer)).toBe(false);
    const thread = makeThread('t1', [makeComment({ author: 'mira' })]);
    expect(readyToLand(makePr({ ...approved, threads: [thread] }), viewer)).toBe(false);
  });

  it('takes a standing approval where the repo asks for no review', () => {
    expect(readyToLand(makePr({ ...approved, reviewDecision: 'NONE' }), viewer)).toBe(true);
    expect(readyToLand(makePr({ author: me, reviewDecision: 'NONE' }), viewer)).toBe(false);
  });
});

describe('pushesSinceYourReview', () => {
  const commits = [makeCommit({ oid: 'a', committedAt: at(1) }), makeCommit({ oid: 'b', committedAt: at(30) }), makeCommit({ oid: 'c', committedAt: at(40) })];

  it('counts commits after the reviewed one, from the newest review of any kind', () => {
    const reviews = [makeReview({ id: 'r1', author: me, state: 'APPROVED', commitOid: 'a', submittedAt: at(10) }), makeReview({ id: 'r2', author: me, state: 'COMMENTED', commitOid: 'b', submittedAt: at(35) })];
    expect(pushesSinceYourReview(makePr({ commits, reviews }), me)).toEqual({ reviewedAt: at(35), reviewState: 'COMMENTED', reviewCommitOid: 'b', commitsSince: 1 });
  });

  it('falls back to time when the reviewed commit is gone', () => {
    const reviews = [makeReview({ author: me, commitOid: 'gone', submittedAt: at(20) })];
    expect(pushesSinceYourReview(makePr({ commits, reviews }), me)?.commitsSince).toBe(2);
  });

  it('is null without a review by the viewer', () => {
    expect(pushesSinceYourReview(makePr({ commits, reviews: [makeReview({ author: 'bob' })] }), me)).toBeNull();
  });

  it('is null when nothing was pushed since the review', () => {
    expect(pushesSinceYourReview(makePr({ commits, reviews: [makeReview({ author: me, commitOid: 'c', submittedAt: at(45) })] }), me)).toBeNull();
  });
});

describe('repliesSinceYourReview', () => {
  it('counts conversation comments and replies on the viewer threads after they last spoke, not bots', () => {
    const pr = makePr({
      reviews: [makeReview({ author: me, state: 'COMMENTED', submittedAt: at(20) })],
      comments: [
        makeComment({ id: 'c1', author: 'alice', kind: 'comment', createdAt: at(10) }),
        makeComment({ id: 'c2', author: 'alice', kind: 'comment', createdAt: at(30) }),
        makeComment({ id: 'c3', author: 'ci-bot[bot]', kind: 'comment', createdAt: at(31) }),
        makeComment({ id: 'c4', author: 'alice', kind: 'review_comment', threadId: 'mine', createdAt: at(32) }),
        makeComment({ id: 'c5', author: 'alice', kind: 'review_comment', threadId: 'other', createdAt: at(33) }),
      ],
      threads: [makeThread('mine', [makeComment({ id: 'c0', author: me, createdAt: at(15) })])],
    });
    expect(repliesSinceYourReview(pr, me)).toEqual({ since: at(20), count: 2 });
  });

  it('is null when the viewer never spoke', () => {
    expect(repliesSinceYourReview(makePr(), me)).toBeNull();
  });

  it('is null when nobody replied since', () => {
    const pr = makePr({ reviews: [makeReview({ author: me, state: 'COMMENTED', submittedAt: at(20) })], comments: [makeComment({ author: 'alice', kind: 'comment', createdAt: at(10) })] });
    expect(repliesSinceYourReview(pr, me)).toBeNull();
  });
});

describe('branchesView', () => {
  const now = new Date(at(60 * 24 * 10));

  it('keeps open PRs and ones that ended within the window, open first, in the asked repo', () => {
    const open = makePr({ number: 1, author: me, updatedAt: at(5) });
    const recent = makePr({ number: 2, author: me, state: 'MERGED', mergedAt: at(60 * 24 * 8), updatedAt: at(60 * 24 * 8) });
    const old = makePr({ number: 3, author: me, state: 'MERGED', mergedAt: at(60 * 24), updatedAt: at(60 * 24) });
    const elsewhere = makePr({ number: 4, repo: 'acme/web', author: me });
    const view = branchesView([recent, old, open, elsewhere].map(input), viewer, now, { days: 7, repo: 'acme/app' });
    expect(view.viewer).toBe(me);
    expect(view.generatedAt).toBe(now.toISOString());
    expect(view.prs.map((entry) => entry.key)).toEqual(['acme/app#1', 'acme/app#2']);
  });
});
