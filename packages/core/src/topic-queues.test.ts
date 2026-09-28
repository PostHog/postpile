import { describe, expect, it } from 'vitest';
import { makeComment, makePr, makeReview, makeThread, viewer } from './fixtures.ts';
import { personRelation, tileTier, topicPeople, topicQueues } from './topic-queues.ts';
import type { Viewer } from './types.ts';

const me = viewer.login;
const withTeam: Viewer = { ...viewer, teamMembers: ['lyra', 'rowan'] };

describe('personRelation', () => {
  it('tells you, your team and everyone else apart', () => {
    expect(personRelation(me, withTeam)).toBe('you');
    expect(personRelation('Lyra', withTeam)).toBe('team');
    expect(personRelation('ada', withTeam)).toBe('other');
    expect(personRelation(me, null)).toBe('other');
  });
});

describe('topicPeople', () => {
  it('collects authors, reviewers and commenters once, bots left out', () => {
    const prs = [
      makePr({
        author: 'ada',
        reviews: [makeReview({ author: 'bob' }), makeReview({ author: 'pending-pat', state: 'PENDING' })],
        reviewerUsers: ['carl'],
        comments: [makeComment({ author: 'github-actions' }), makeComment({ author: 'dora' })],
        threads: [makeThread('t1', [makeComment({ author: 'erin' })])],
      }),
      makePr({ number: 2, author: 'renovate[bot]', comments: [makeComment({ author: 'ada' })] }),
    ];
    expect(topicPeople(prs, withTeam).map((person) => person.login)).toEqual(['ada', 'bob', 'carl', 'dora', 'erin']);
  });

  it('puts you and your team first, keeping the order of appearance', () => {
    const prs = [makePr({ author: 'ada', reviews: [makeReview({ author: 'lyra' }), makeReview({ author: me })], reviewerUsers: ['bob', 'rowan'] })];
    expect(topicPeople(prs, withTeam)).toEqual([
      { login: 'lyra', relation: 'team' },
      { login: me, relation: 'you' },
      { login: 'rowan', relation: 'team' },
      { login: 'ada', relation: 'other' },
      { login: 'bob', relation: 'other' },
    ]);
  });
});

describe('topicQueues', () => {
  it('counts PRs per tier and open PRs by author', () => {
    const queues = topicQueues([
      { tier: 'needs_reply', author: 'you', state: 'OPEN' },
      { tier: 'mine', author: 'you', state: 'OPEN' },
      { tier: 'team', author: 'team', state: 'OPEN' },
      { tier: 'rest', author: 'team', state: 'MERGED' },
      { tier: 'rest', author: 'you', state: 'CLOSED' },
      { tier: 'to_review', author: 'other', state: 'OPEN' },
    ]);
    expect(queues.tiers).toEqual({ needs_reply: 1, mine: 1, team: 1, to_review: 1, team_mentioned: 0, rest: 2 });
    expect(queues.byYou).toBe(2);
    expect(queues.byTeam).toBe(1);
  });
});

describe('tileTier', () => {
  it('takes the most urgent tier among the PRs', () => {
    expect(tileTier(['rest', 'to_review', 'team'])).toBe('team');
    expect(tileTier(['rest', 'needs_reply'])).toBe('needs_reply');
    expect(tileTier([])).toBe('rest');
  });
});
