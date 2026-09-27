import { describe, expect, it } from 'vitest';
import { makePr, makeThreadFor, viewer } from './fixtures.ts';
import { relationSignals, topicPlacement } from './topic-relation.ts';

const devex = { ...viewer, teams: ['PostHog/team-devex'] };

describe('relationSignals', () => {
  it('is team when the user authors or drives the work', () => {
    const pr = makePr({ author: devex.login });
    expect(relationSignals({ viewer: devex, prs: [pr], threads: [], driver: null })).toMatchObject({
      relation: 'team',
      ownerTeam: 'PostHog/team-devex',
      whyYou: 'you author PRs here',
    });
    expect(relationSignals({ viewer: devex, prs: [makePr()], threads: [], driver: devex.login }).whyYou).toBe('you drive it');
  });

  it('is fyi when every thread is passive', () => {
    const pr = makePr({ reviewerUsers: [] });
    const result = relationSignals({ viewer: devex, prs: [pr], threads: [makeThreadFor(pr, { reason: 'subscribed' })], driver: 'alice' });
    expect(result).toMatchObject({ relation: 'fyi', whyYou: 'subscribed' });
  });

  it('leaves a team review request to the agent, with where it lands', () => {
    const pr = makePr({
      reviewerUsers: [],
      reviewerTeams: ['PostHog/team-devex'],
      files: [{ path: '.github/workflows/ci.yml', additions: 1, deletions: 0 }],
    });
    const result = relationSignals({ viewer: devex, prs: [pr], threads: [makeThreadFor(pr, { reason: 'review_requested' })], driver: 'alice' });
    expect(result).toMatchObject({ relation: null, whyYou: 'team-devex review requested on .github/workflows' });
  });

  it('leaves a direct review request or a mention to the agent too', () => {
    const pr = makePr({ reviewerUsers: [devex.login] });
    expect(relationSignals({ viewer: devex, prs: [pr], threads: [], driver: 'alice' })).toMatchObject({ relation: null, whyYou: 'your review requested' });
    const mentioned = makePr({ reviewerUsers: [] });
    const thread = makeThreadFor(mentioned, { reason: 'mention' });
    expect(relationSignals({ viewer: devex, prs: [mentioned], threads: [thread], driver: 'alice' }).whyYou).toBe('you were mentioned');
  });
});

describe('topicPlacement', () => {
  const relation = { kind: 'routed' as const, ownerTeam: 'PostHog/team-infra', whyYou: 'team-devex review requested' };

  it('uses the dossier relation and the topic area', () => {
    expect(topicPlacement(relation, 'CI', null, 0)).toEqual({
      relation: 'routed',
      ownerTeam: 'PostHog/team-infra',
      whyYou: 'team-devex review requested',
      area: 'CI',
      corrected: false,
    });
  });

  it('lets a user correction win until new events arrive', () => {
    expect(topicPlacement(relation, 'CI', { relation: 'fyi', seq: 10 }, 0)).toMatchObject({ relation: 'fyi', corrected: true });
    expect(topicPlacement(relation, 'CI', { relation: 'fyi', seq: 10 }, 2)).toMatchObject({ relation: 'routed', corrected: false });
    expect(topicPlacement(undefined, null, null, 0)).toBeNull();
  });
});
