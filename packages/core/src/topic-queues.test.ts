import { describe, expect, it } from 'vitest';
import { makeComment, makePr, makeReview, makeThread, viewer } from './fixtures.ts';
import { memberTier, personRelation, pingedPrKeys, tileTier, topicPeople, topicQueues } from './topic-queues.ts';
import type { Tile, Viewer } from './types.ts';

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
      { tier: 'needs_reply', author: 'you', state: 'OPEN', pulledIn: false, quiet: false },
      { tier: 'mine', author: 'you', state: 'OPEN', pulledIn: false, quiet: false },
      { tier: 'team', author: 'team', state: 'OPEN', pulledIn: false, quiet: false },
      { tier: 'rest', author: 'team', state: 'MERGED', pulledIn: false, quiet: false },
      { tier: 'rest', author: 'you', state: 'CLOSED', pulledIn: false, quiet: false },
      { tier: 'to_review', author: 'other', state: 'OPEN', pulledIn: false, quiet: false },
    ]);
    expect(queues.tiers).toEqual({ needs_reply: 1, mine: 1, team: 1, to_review: 1, team_mentioned: 0, rest: 2 });
    expect(queues.byYou).toBe(2);
    expect(queues.byTeam).toBe(1);
  });

  it('leaves PRs in quiet repos out of every count', () => {
    const queues = topicQueues([
      { tier: 'needs_reply', author: 'you', state: 'OPEN', pulledIn: false, quiet: true },
      { tier: 'to_review', author: 'other', state: 'OPEN', pulledIn: false, quiet: false },
    ]);
    expect(queues).toEqual({ tiers: { needs_reply: 0, mine: 0, team: 0, to_review: 1, team_mentioned: 0, rest: 0 }, byYou: 0, byTeam: 0 });
  });

  it('leaves pulled-in stack layers out of every count', () => {
    const queues = topicQueues([
      { tier: 'to_review', author: 'other', state: 'OPEN', pulledIn: false, quiet: false },
      { tier: 'mine', author: 'you', state: 'OPEN', pulledIn: true, quiet: false },
      { tier: 'team', author: 'team', state: 'OPEN', pulledIn: true, quiet: false },
    ]);
    expect(queues).toEqual({ tiers: { needs_reply: 0, mine: 0, team: 0, to_review: 1, team_mentioned: 0, rest: 0 }, byYou: 0, byTeam: 0 });
  });
});

describe('pingedPrKeys', () => {
  it('counts a PR as pinged when any tile holds it pinged', () => {
    const tile = (id: string, members: Tile['members']): Tile => ({ id, topicId: 't', kind: 'stack', title: id, members });
    const keys = pingedPrKeys([
      tile('stack', [
        { prKey: 'o/r#1', provenance: { kind: 'pulled_in', reason: 'stack layer below #2' } },
        { prKey: 'o/r#2', provenance: { kind: 'pinged', reason: 'review_requested' } },
        { prKey: 'o/r#3', provenance: { kind: 'pulled_in', reason: 'stack layer above #2' } },
      ]),
      tile('single', [{ prKey: 'o/r#3', provenance: { kind: 'pinged', reason: 'mention' } }]),
    ]);
    expect([...keys].sort()).toEqual(['o/r#2', 'o/r#3']);
  });
});

describe('memberTier', () => {
  it('puts a pulled-in layer outside the tiers', () => {
    expect(memberTier('mine', { kind: 'pulled_in', reason: 'stack layer below #2' }, false)).toBe('rest');
    expect(memberTier('mine', { kind: 'pinged', reason: 'author' }, false)).toBe('mine');
  });

  it('puts a PR in a quiet repo outside the tiers', () => {
    expect(memberTier('needs_reply', { kind: 'pinged', reason: 'mention' }, true)).toBe('rest');
  });
});

describe('tileTier', () => {
  it('takes the most urgent tier among the PRs', () => {
    expect(tileTier(['rest', 'to_review', 'team'])).toBe('team');
    expect(tileTier(['rest', 'needs_reply'])).toBe('needs_reply');
    expect(tileTier([])).toBe('rest');
  });
});
