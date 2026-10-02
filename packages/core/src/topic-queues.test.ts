import { describe, expect, it } from 'vitest';
import { makeComment, makePr, makeReview, makeThread, viewer } from './fixtures.ts';
import { emptyTierCounts, memberTier, personRelation, pingedPrKeys, tileTier, topicFaces, topicPeople, topicQueues, topicSection } from './topic-queues.ts';
import type { PrTier } from './pr-tier.ts';
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
  it('collects PR authors only, once each, bots left out', () => {
    const prs = [
      makePr({
        author: 'ada',
        reviews: [makeReview({ author: 'bob' })],
        reviewerUsers: ['carl'],
        comments: [makeComment({ author: 'dora' })],
        threads: [makeThread('t1', [makeComment({ author: 'erin' })])],
      }),
      makePr({ number: 2, author: 'renovate[bot]', comments: [makeComment({ author: 'ada' })] }),
      makePr({ number: 3, author: 'Ada' }),
    ];
    expect(topicPeople(prs, withTeam)).toEqual([{ login: 'ada', relation: 'other' }]);
  });

  it('orders you, your teammates, then others by number of PRs', () => {
    const prs = [
      makePr({ number: 1, author: 'ada' }),
      makePr({ number: 2, author: 'lyra' }),
      makePr({ number: 3, author: 'bob' }),
      makePr({ number: 4, author: 'bob' }),
      makePr({ number: 5, author: 'rowan' }),
      makePr({ number: 6, author: 'rowan' }),
      makePr({ number: 7, author: me }),
    ];
    expect(topicPeople(prs, withTeam)).toEqual([
      { login: me, relation: 'you' },
      { login: 'rowan', relation: 'team' },
      { login: 'lyra', relation: 'team' },
      { login: 'bob', relation: 'other' },
      { login: 'ada', relation: 'other' },
    ]);
  });

  it('keeps the order of first appearance on equal counts', () => {
    const prs = [makePr({ number: 1, author: 'ada' }), makePr({ number: 2, author: 'bob' })];
    expect(topicPeople(prs, withTeam).map((person) => person.login)).toEqual(['ada', 'bob']);
  });
});

describe('topicFaces', () => {
  const person = (login: string, relation: 'you' | 'team' | 'other') => ({ login, relation });

  it('fills up to three faces: you and your team first, then others', () => {
    const people = [person(me, 'you'), person('lyra', 'team'), person('ada', 'other'), person('bob', 'other')];
    expect(topicFaces(people)).toEqual([person(me, 'you'), person('lyra', 'team'), person('ada', 'other')]);
  });

  it('shows others when nobody from your team authored', () => {
    const others = ['a', 'b', 'c', 'd'].map((login) => person(login, 'other'));
    expect(topicFaces(others)).toEqual(others.slice(0, 3));
  });

  it('leaves no room for others when you and two teammates authored', () => {
    const people = [person(me, 'you'), person('t1', 'team'), person('t2', 'team'), person('t3', 'team'), person('ada', 'other')];
    expect(topicFaces(people).map((face) => face.login)).toEqual([me, 't1', 't2']);
  });

  it('shows nobody for a topic without people', () => {
    expect(topicFaces([])).toEqual([]);
  });
});

describe('topicQueues', () => {
  it('counts PRs per tier and open PRs by author', () => {
    const queues = topicQueues([
      { tier: 'needs_reply', author: 'you', state: 'OPEN', pulledIn: false, quiet: false, changesAddressed: false },
      { tier: 'mine', author: 'you', state: 'OPEN', pulledIn: false, quiet: false, changesAddressed: false },
      { tier: 'team', author: 'team', state: 'OPEN', pulledIn: false, quiet: false, changesAddressed: false },
      { tier: 'rest', author: 'team', state: 'MERGED', pulledIn: false, quiet: false, changesAddressed: false },
      { tier: 'rest', author: 'you', state: 'CLOSED', pulledIn: false, quiet: false, changesAddressed: false },
      { tier: 'to_review', author: 'other', state: 'OPEN', pulledIn: false, quiet: false, changesAddressed: false },
    ]);
    expect(queues.tiers).toEqual({ needs_reply: 1, changes_requested: 0, mine: 1, team: 1, to_review: 1, team_mentioned: 0, rest: 2 });
    expect(queues.byYou).toBe(2);
    expect(queues.byTeam).toBe(1);
  });

  it('counts Changes you requested PRs, and the addressed ones apart', () => {
    const queues = topicQueues([
      { tier: 'changes_requested', author: 'other', state: 'OPEN', pulledIn: false, quiet: false, changesAddressed: true },
      { tier: 'changes_requested', author: 'team', state: 'OPEN', pulledIn: false, quiet: false, changesAddressed: false },
      // An ask from someone else wins the tier, so the addressed PR counts under needs_reply only.
      { tier: 'needs_reply', author: 'other', state: 'OPEN', pulledIn: false, quiet: false, changesAddressed: true },
    ]);
    expect(queues.tiers).toMatchObject({ needs_reply: 1, changes_requested: 2 });
    expect(queues.changesAddressed).toBe(1);
    expect(queues.byTeam).toBe(1);
  });

  it('leaves PRs in quiet repos out of every count', () => {
    const queues = topicQueues([
      { tier: 'needs_reply', author: 'you', state: 'OPEN', pulledIn: false, quiet: true, changesAddressed: false },
      { tier: 'to_review', author: 'other', state: 'OPEN', pulledIn: false, quiet: false, changesAddressed: false },
    ]);
    expect(queues).toEqual({ tiers: { needs_reply: 0, changes_requested: 0, mine: 0, team: 0, to_review: 1, team_mentioned: 0, rest: 0 }, byYou: 0, byTeam: 0, changesAddressed: 0 });
  });

  it('leaves pulled-in stack layers out of every count', () => {
    const queues = topicQueues([
      { tier: 'to_review', author: 'other', state: 'OPEN', pulledIn: false, quiet: false, changesAddressed: false },
      { tier: 'mine', author: 'you', state: 'OPEN', pulledIn: true, quiet: false, changesAddressed: false },
      { tier: 'team', author: 'team', state: 'OPEN', pulledIn: true, quiet: false, changesAddressed: false },
    ]);
    expect(queues).toEqual({ tiers: { needs_reply: 0, changes_requested: 0, mine: 0, team: 0, to_review: 1, team_mentioned: 0, rest: 0 }, byYou: 0, byTeam: 0, changesAddressed: 0 });
  });
});

describe('topicSection', () => {
  const section = (tiers: Partial<Record<PrTier, number>>) => topicSection({ tiers: { ...emptyTierCounts(), ...tiers } });

  it('puts a topic in its highest section, rest-only topics under Other topics', () => {
    expect(section({ needs_reply: 1, team: 2, rest: 3 })).toBe('needs_reply');
    expect(section({ changes_requested: 1, to_review: 1 })).toBe('changes_requested');
    expect(section({ rest: 2 })).toBeNull();
    expect(section({})).toBeNull();
  });

  it('lets a mixed topic follow what it asks of you: an ask first, then your PR, then a teammate\'s', () => {
    expect(section({ mine: 2, to_review: 1 })).toBe('to_review');
    expect(section({ mine: 1, team_mentioned: 1 })).toBe('team_mentioned');
    expect(section({ mine: 1, team: 1 })).toBe('mine');
    expect(section({ team: 2, rest: 1 })).toBe('team');
    expect(section({ mine: 3, rest: 2 })).toBe('mine');
  });
});

describe('pingedPrKeys', () => {
  it('counts a PR as pinged when any tile holds it pinged', () => {
    const tile = (id: string, members: Tile['members']): Tile => ({ id, topicId: 't', kind: 'stack', title: id, members, stacks: [] });
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
