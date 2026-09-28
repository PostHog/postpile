import { describe, expect, it } from 'vitest';
import { forWhom, tileForWhom } from './for-whom.ts';
import { makeComment, makePr, makeReview, makeTimelineItem, viewer } from './fixtures.ts';

const other = makePr({ author: 'rowan' });

describe('forWhom', () => {
  it('says "for you" when the viewer is asked or addressed', () => {
    expect(forWhom('RV', other, viewer)).toEqual({ kind: 'you' });
    expect(forWhom('@', other, viewer)).toEqual({ kind: 'you' });
    expect(forWhom('AS', other, viewer)).toEqual({ kind: 'you' });
  });

  it('names the team from a pending request, the timeline or a mention', () => {
    expect(forWhom('RT', { ...other, reviewerTeams: ['acme/team-platform'] }, viewer)).toEqual({ kind: 'team', team: 'team-platform' });
    const inTimeline = { ...other, timeline: [makeTimelineItem({ subject: 'acme/team-platform' })] };
    expect(forWhom('RT', inTimeline, viewer)).toEqual({ kind: 'team', team: 'team-platform' });
    const mentioned = { ...other, comments: [makeComment({ body: 'cc @acme/team-platform' })] };
    expect(forWhom('@T', mentioned, viewer)).toEqual({ kind: 'team', team: 'team-platform' });
    expect(forWhom('@T', other, { ...viewer, teams: [] })).toEqual({ kind: 'team', team: 'your team' });
  });

  it('says "for you" for a team request on a teammate\'s PR nobody else on the team covered', () => {
    const withTeam = { ...viewer, teamMembers: ['lyra', 'rowan'] };
    const byTeammate = makePr({ author: 'lyra', reviewerTeams: ['acme/team-platform'] });
    expect(forWhom('RT', byTeammate, withTeam)).toEqual({ kind: 'you' });
    const commented = { ...byTeammate, reviews: [makeReview({ author: 'rowan', state: 'COMMENTED' })] };
    expect(forWhom('RT', commented, withTeam)).toEqual({ kind: 'you' });
    const approved = { ...byTeammate, reviews: [makeReview({ author: 'rowan', state: 'APPROVED' })] };
    expect(forWhom('RT', approved, withTeam)).toEqual({ kind: 'team', team: 'team-platform' });
    const routed = makePr({ author: 'ada', reviewerTeams: ['acme/team-platform'] });
    expect(forWhom('RT', routed, withTeam)).toEqual({ kind: 'team', team: 'team-platform' });
  });

  it('marks the viewer\'s own PR as own, even with a team request on it', () => {
    const own = makePr({ author: viewer.login, reviewerTeams: ['acme/team-platform'] });
    expect(forWhom('RT', own, viewer)).toEqual({ kind: 'own' });
    expect(forWhom('AU', other, viewer)).toEqual({ kind: 'own' });
  });

  it('gives no chip to following, took part and stack context', () => {
    expect(forWhom('FW', other, viewer)).toEqual({ kind: 'none' });
    expect(forWhom('CM', other, viewer)).toEqual({ kind: 'none' });
    expect(forWhom('ST', other, viewer)).toEqual({ kind: 'none' });
  });
});

describe('tileForWhom', () => {
  it('takes the most aimed: you, then team, then own', () => {
    const team = { kind: 'team' as const, team: 'team-platform' };
    expect(tileForWhom([{ kind: 'own' }, team, { kind: 'you' }])).toEqual({ kind: 'you' });
    expect(tileForWhom([{ kind: 'own' }, team])).toEqual(team);
    expect(tileForWhom([{ kind: 'none' }, { kind: 'own' }])).toEqual({ kind: 'own' });
    expect(tileForWhom([])).toEqual({ kind: 'none' });
  });
});
