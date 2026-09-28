import { describe, expect, it } from 'vitest';
import { at, makePr, makeReview, makeUserState, viewer } from './fixtures.ts';
import { isApprovedByViewer, isPersonalRequest, newestVerdictBy, viewerApproval, reviewPending, reviewRequest, teamRequestTakenBy } from './review-request.ts';
import type { Viewer } from './types.ts';

const me = viewer.login;
const withTeam: Viewer = { ...viewer, teamMembers: ['lyra', 'rowan'] };
const team = ['PostHog/team-devex'];

describe('reviewRequest', () => {
  it('is personal when the viewer is requested, whoever wrote it', () => {
    expect(reviewRequest(makePr({ author: 'ada', reviewerUsers: [me] }), withTeam)).toBe('you');
    expect(reviewRequest(makePr({ author: 'lyra', reviewerUsers: [me], reviewerTeams: team }), withTeam)).toBe('you');
  });

  it('counts a team request on a teammate\'s PR like a personal one until another teammate approves or asks for changes', () => {
    const pr = makePr({ author: 'lyra', reviewerTeams: team });
    expect(reviewRequest(pr, withTeam)).toBe('team_for_you');
    expect(reviewRequest({ ...pr, reviews: [makeReview({ author: 'rowan', state: 'COMMENTED' })] }, withTeam)).toBe('team_for_you');
    expect(reviewRequest({ ...pr, reviews: [makeReview({ author: 'rowan', state: 'CHANGES_REQUESTED' })] }, withTeam)).toBe('team_taken');
    expect(reviewRequest({ ...pr, reviews: [makeReview({ author: 'rowan', state: 'APPROVED' })] }, withTeam)).toBe('team_taken');
    // The author's own review and outsiders do not cover it.
    expect(reviewRequest({ ...pr, reviews: [makeReview({ author: 'lyra', state: 'COMMENTED' }), makeReview({ author: 'mira' })] }, withTeam)).toBe('team_for_you');
  });

  it('keeps a team request on an outsider\'s PR routed, taken by any teammate review', () => {
    const pr = makePr({ author: 'ada', reviewerTeams: team });
    expect(reviewRequest(pr, withTeam)).toBe('team');
    expect(reviewRequest({ ...pr, reviews: [makeReview({ author: 'rowan', state: 'COMMENTED' })] }, withTeam)).toBe('team_taken');
    expect(teamRequestTakenBy({ ...pr, reviews: [makeReview({ author: 'rowan', state: 'COMMENTED' })] }, withTeam)).toEqual(['rowan']);
  });

  it('cannot tell a teammate\'s PR before the member list is fetched', () => {
    expect(reviewRequest(makePr({ author: 'lyra', reviewerTeams: team }), viewer)).toBe('team');
  });

  it('is null without a request for the viewer or their teams', () => {
    expect(reviewRequest(makePr({ reviewerUsers: ['sol'], reviewerTeams: ['PostHog/team-other'] }), withTeam)).toBeNull();
  });

  it('treats personal and teammate team requests as personal', () => {
    expect(isPersonalRequest('you')).toBe(true);
    expect(isPersonalRequest('team_for_you')).toBe(true);
    expect(isPersonalRequest('team')).toBe(false);
    expect(isPersonalRequest('team_taken')).toBe(false);
  });
});

describe('reviewPending', () => {
  it('holds until the viewer reviewed the head or approved any commit', () => {
    const pr = makePr({ author: 'ada', reviewerUsers: [me] });
    expect(reviewPending(pr, withTeam)).toBe(true);
    expect(reviewPending({ ...pr, reviews: [makeReview({ author: me, state: 'COMMENTED' })] }, withTeam)).toBe(false);
    expect(reviewPending({ ...pr, reviews: [makeReview({ author: me, commitOid: 'old' })] }, withTeam)).toBe(false);
  });

  it('is off for drafts, own PRs, closed PRs and taken team requests', () => {
    expect(reviewPending(makePr({ author: 'ada', reviewerUsers: [me], isDraft: true }), withTeam)).toBe(false);
    expect(reviewPending(makePr({ author: me, reviewerTeams: team }), withTeam)).toBe(false);
    expect(reviewPending(makePr({ author: 'ada', reviewerUsers: [me], state: 'MERGED' }), withTeam)).toBe(false);
    const taken = makePr({ author: 'ada', reviewerTeams: team, reviews: [makeReview({ author: 'rowan' })] });
    expect(reviewPending(taken, withTeam)).toBe(false);
  });
});

describe('isApprovedByViewer', () => {
  const pr = makePr({ author: 'ada', headOid: 'c1' });
  const inApp = makeUserState({ prKey: pr.key, approvedAt: at(30), approvedCommitOid: 'c1' });

  it('trusts the in-app approval until GitHub shows the review', () => {
    expect(isApprovedByViewer(pr, inApp, me)).toBe(true);
  });

  it('lets a dismissal win once GitHub shows the review, even with the old submittedAt', () => {
    const dismissed = { ...pr, reviews: [makeReview({ author: me, state: 'DISMISSED', commitOid: 'c1', submittedAt: at(20) })] };
    expect(isApprovedByViewer(dismissed, inApp, me)).toBe(false);
  });

  it('lets a newer change request win once GitHub shows the approval', () => {
    const reviews = [
      makeReview({ id: 'r1', author: me, state: 'APPROVED', commitOid: 'c1', submittedAt: at(20) }),
      makeReview({ id: 'r2', author: me, state: 'CHANGES_REQUESTED', commitOid: 'c2', submittedAt: at(25) }),
    ];
    expect(isApprovedByViewer({ ...pr, reviews }, inApp, me)).toBe(false);
  });
});

describe('viewerApproval', () => {
  const pr = makePr({ author: 'ada', headOid: 'head' });

  it('reads the newest approving review, with its commit', () => {
    const reviews = [makeReview({ author: me, commitOid: 'old', submittedAt: at(10) })];
    expect(viewerApproval({ ...pr, reviews }, null, me)).toEqual({ at: at(10), commitOid: 'old' });
  });

  it('reads the app record while GitHub does not show it yet', () => {
    const state = makeUserState({ prKey: pr.key, approvedAt: at(5), approvedCommitOid: 'old' });
    expect(viewerApproval(pr, state, me)).toEqual({ at: at(5), commitOid: 'old' });
  });

  it('follows the newest verdict: a later change request undoes an approval, a later approval stands', () => {
    const undone = [makeReview({ id: 'a', author: me, commitOid: 'a', submittedAt: at(10) }), makeReview({ id: 'b', author: me, state: 'CHANGES_REQUESTED', submittedAt: at(20) })];
    expect(viewerApproval({ ...pr, reviews: undone }, null, me)).toBeNull();
    const redone = [makeReview({ id: 'a', author: me, state: 'CHANGES_REQUESTED', submittedAt: at(10) }), makeReview({ id: 'b', author: me, commitOid: 'b', submittedAt: at(20) })];
    expect(viewerApproval({ ...pr, reviews: redone }, null, me)).toEqual({ at: at(20), commitOid: 'b' });
    // A change request newer than the app record undoes that record too.
    const state = makeUserState({ prKey: pr.key, approvedAt: at(10), approvedCommitOid: 'x' });
    expect(viewerApproval({ ...pr, reviews: [makeReview({ author: me, state: 'CHANGES_REQUESTED', submittedAt: at(20) })] }, state, me)).toBeNull();
  });

  it('is null after a dismissal or without a verdict', () => {
    expect(viewerApproval({ ...pr, reviews: [makeReview({ author: me, state: 'DISMISSED' })] }, null, me)).toBeNull();
    expect(viewerApproval({ ...pr, reviews: [makeReview({ author: me, state: 'COMMENTED' })] }, null, me)).toBeNull();
  });
});

describe('newestVerdictBy', () => {
  it('skips comment reviews and other authors', () => {
    const reviews = [
      makeReview({ id: 'a', author: me, state: 'CHANGES_REQUESTED', submittedAt: at(10) }),
      makeReview({ id: 'b', author: me, state: 'COMMENTED', submittedAt: at(20) }),
      makeReview({ id: 'c', author: 'lyra', state: 'APPROVED', submittedAt: at(30) }),
    ];
    expect(newestVerdictBy(reviews, me)?.id).toBe('a');
  });
});
