import { describe, expect, it } from 'vitest';
import { makePr, makeReview, viewer } from './fixtures.ts';
import { isPersonalRequest, reviewPending, reviewRequest, teamRequestTakenBy } from './review-request.ts';
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
