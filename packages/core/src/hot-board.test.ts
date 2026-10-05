import { describe, expect, it } from 'vitest';
import {
  busyInboxView,
  compareHotRank,
  hotFactsOf,
  hotRank,
  hotTier,
  isHotByRule,
  selectHotBoard,
  settledSince,
  withGroups,
  wouldKeep,
  type HotFacts,
} from './hot-board.ts';
import type { Viewer } from './types.ts';

const NOW = '2026-10-05T12:00:00.000Z';
const SINCE = settledSince(NOW);
const RECENT = '2026-10-04T12:00:00.000Z';
const OLD = '2026-09-01T12:00:00.000Z';

const me: Viewer = {
  login: 'alice',
  teams: ['acme/team-devex', 'acme/team-routing'],
  homeTeams: ['acme/team-devex'],
  teamMembers: ['bob'],
};

function facts(key: string, overrides: Partial<HotFacts> = {}): HotFacts {
  return {
    key,
    state: 'MERGED',
    author: 'zoe',
    assignees: [],
    reviewerUsers: [],
    reviewerTeams: [],
    thread: null,
    found: null,
    personalAsk: false,
    activityAt: OLD,
    ...overrides,
  };
}

describe('hotFactsOf', () => {
  it('takes the newest of the PR update, its newest event and its thread update as its activity', () => {
    const light = {
      key: 'acme/app#1',
      ref: { repo: 'acme/app', number: 1 },
      state: 'MERGED' as const,
      baseRef: 'main',
      headRef: 'feat',
      createdAt: OLD,
      updatedAt: OLD,
      mergedAt: OLD,
      title: 'Move CI to Depot',
      author: 'alice',
      assignees: [],
      reviewerUsers: [],
      reviewerTeams: [],
      lastEventAt: '2026-09-20T12:00:00.000Z',
    };
    const thread = { unread: false, reason: 'author' as const, updatedAt: RECENT };
    expect(hotFactsOf(light, { thread, found: null, personalAsk: false })).toMatchObject({ activityAt: RECENT, thread: { unread: false, reason: 'author' } });
    expect(hotFactsOf(light, { thread: null, found: 'own_open', personalAsk: true })).toMatchObject({ activityAt: '2026-09-20T12:00:00.000Z', found: 'own_open', personalAsk: true });
  });
});

describe('isHotByRule', () => {
  it('takes an unread thread whatever its age or state', () => {
    expect(isHotByRule(facts('acme/app#1', { thread: { unread: true, reason: 'subscribed' } }), SINCE)).toBe(true);
  });

  it('takes an open PR that has a thread or was found', () => {
    expect(isHotByRule(facts('acme/app#1', { state: 'OPEN', thread: { unread: false, reason: 'subscribed' } }), SINCE)).toBe(true);
    expect(isHotByRule(facts('acme/app#2', { state: 'OPEN', found: 'own_open' }), SINCE)).toBe(true);
  });

  it('leaves an old open PR nothing tracks', () => {
    expect(isHotByRule(facts('acme/app#1', { state: 'OPEN' }), SINCE)).toBe(false);
  });

  it('takes a settled PR with activity in the last week, not an older one', () => {
    const read = { unread: false, reason: 'subscribed' as const };
    expect(isHotByRule(facts('acme/app#1', { thread: read, activityAt: RECENT }), SINCE)).toBe(true);
    expect(isHotByRule(facts('acme/app#2', { thread: read, activityAt: OLD }), SINCE)).toBe(false);
  });
});

describe('hotTier', () => {
  it('is you for the viewer own PR, a bot PR assigned to them, and anything aimed at them in person', () => {
    expect(hotTier(facts('acme/app#1', { author: 'alice' }), me)).toBe('you');
    expect(hotTier(facts('acme/app#2', { author: 'renovate[bot]', assignees: ['alice'] }), me)).toBe('you');
    expect(hotTier(facts('acme/app#3', { reviewerUsers: ['Alice'] }), me)).toBe('you');
    expect(hotTier(facts('acme/app#4', { personalAsk: true }), me)).toBe('you');
    expect(hotTier(facts('acme/app#5', { thread: { unread: false, reason: 'mention' } }), me)).toBe('you');
    expect(hotTier(facts('acme/app#6', { found: 'review_requested' }), me)).toBe('you');
  });

  it('is team for a request to a home team or a PR a teammate owns', () => {
    expect(hotTier(facts('acme/app#1', { reviewerTeams: ['acme/team-devex'] }), me)).toBe('team');
    expect(hotTier(facts('acme/app#2', { author: 'bob' }), me)).toBe('team');
  });

  it('is others for a routing-only team request and everything else', () => {
    expect(hotTier(facts('acme/app#1', { reviewerTeams: ['acme/team-routing'] }), me)).toBe('others');
    expect(hotTier(facts('acme/app#2', { thread: { unread: true, reason: 'subscribed' } }), me)).toBe('others');
    expect(hotTier(facts('acme/app#3', { author: 'alice' }), null)).toBe('others');
  });
});

describe('compareHotRank', () => {
  it('goes by tier, then unread first, then newest activity', () => {
    const ranks = [
      hotRank(facts('acme/app#1', { activityAt: RECENT }), me),
      hotRank(facts('acme/app#2', { author: 'bob', activityAt: OLD }), me),
      hotRank(facts('acme/app#3', { author: 'alice', activityAt: OLD }), me),
      hotRank(facts('acme/app#4', { author: 'alice', activityAt: RECENT }), me),
      hotRank(facts('acme/app#5', { author: 'alice', activityAt: OLD, thread: { unread: true, reason: 'author' } }), me),
    ];
    expect(ranks.sort(compareHotRank).map((rank) => rank.key)).toEqual(['acme/app#5', 'acme/app#4', 'acme/app#3', 'acme/app#2', 'acme/app#1']);
  });
});

describe('selectHotBoard', () => {
  const unread = { unread: true, reason: 'subscribed' as const };

  it('keeps every hot PR with its whole stack and set while under the cap', () => {
    const selection = selectHotBoard({
      facts: [
        facts('acme/app#1', { thread: unread }),
        facts('acme/app#2'),
        facts('acme/app#3'),
        facts('acme/app#4'),
        facts('acme/app#5'),
      ],
      groups: [
        ['acme/app#1', 'acme/app#2'],
        ['acme/app#2', 'acme/app#3', 'acme/app#9'],
      ],
      viewer: me,
      now: NOW,
      max: 10,
    });
    expect([...selection.keys].sort()).toEqual(['acme/app#1', 'acme/app#2', 'acme/app#3']);
    expect(selection).toMatchObject({ inboxPrs: 3, busy: false, weakestKept: null });
  });

  it('is not busy when only settled PRs went cold', () => {
    const selection = selectHotBoard({ facts: [facts('acme/app#1'), facts('acme/app#2'), facts('acme/app#3')], groups: [], viewer: me, now: NOW, max: 1 });
    expect(selection).toMatchObject({ inboxPrs: 0, busy: false });
    expect(selection.keys.size).toBe(0);
  });

  it('when busy keeps you, then team, and gives others nothing even with room left', () => {
    const selection = selectHotBoard({
      facts: [
        facts('acme/app#1', { author: 'alice', state: 'OPEN', found: 'own_open', activityAt: RECENT }),
        facts('acme/app#2', { reviewerTeams: ['acme/team-devex'], state: 'OPEN', thread: unread }),
        facts('acme/app#3', { thread: unread, activityAt: RECENT }),
        facts('acme/app#4', { thread: unread, activityAt: RECENT }),
        facts('acme/app#5', { thread: unread, activityAt: RECENT }),
      ],
      groups: [],
      viewer: me,
      now: NOW,
      max: 4,
    });
    expect([...selection.keys].sort()).toEqual(['acme/app#1', 'acme/app#2']);
    expect(selection).toMatchObject({ inboxPrs: 5, busy: true, keptByTier: { you: 1, team: 1, others: 0 }, weakestKept: null });
  });

  it('cuts tiers you and team by rank once they fill the cap, never splitting a stack', () => {
    const own = (key: string, activityAt: string) => facts(key, { author: 'alice', state: 'OPEN', found: 'own_open', activityAt });
    const selection = selectHotBoard({
      facts: [own('acme/app#1', '2026-10-05T10:00:00.000Z'), own('acme/app#2', '2026-10-05T09:00:00.000Z'), facts('acme/app#3'), own('acme/app#4', '2026-10-05T08:00:00.000Z')],
      groups: [['acme/app#2', 'acme/app#3']],
      viewer: me,
      now: NOW,
      max: 2,
    });
    // #1 first; #2 brings its stack layer #3 along and takes the board past the cap; #4 is cut.
    expect([...selection.keys].sort()).toEqual(['acme/app#1', 'acme/app#2', 'acme/app#3']);
    expect(selection.keptByTier).toEqual({ you: 2, team: 0, others: 1 });
    expect(selection.weakestKept?.key).toBe('acme/app#2');
  });
});

describe('withGroups', () => {
  it('brings each seed stack and set along, transitively', () => {
    const groups = [
      ['acme/app#1', 'acme/app#2'],
      ['acme/app#2', 'acme/app#3'],
      ['acme/app#7', 'acme/app#8'],
    ];
    expect([...withGroups(['acme/app#1'], groups)].sort()).toEqual(['acme/app#1', 'acme/app#2', 'acme/app#3']);
    expect([...withGroups(['acme/app#5'], groups)]).toEqual(['acme/app#5']);
  });
});

describe('wouldKeep', () => {
  const rank = (tier: 'you' | 'team' | 'others', activityAt: string) => ({ key: 'acme/app#9', tier, unread: false, activityAt });

  it('keeps anything while the inbox is not busy', () => {
    expect(wouldKeep({ busy: false, weakestKept: null }, rank('others', OLD))).toBe(true);
  });

  it('while busy keeps you and team, and past a full cap only what ranks before the weakest kept', () => {
    expect(wouldKeep({ busy: true, weakestKept: null }, rank('others', RECENT))).toBe(false);
    expect(wouldKeep({ busy: true, weakestKept: null }, rank('team', OLD))).toBe(true);
    const weakest = { key: 'acme/app#1', tier: 'team' as const, unread: false, activityAt: RECENT };
    expect(wouldKeep({ busy: true, weakestKept: weakest }, rank('team', OLD))).toBe(false);
    expect(wouldKeep({ busy: true, weakestKept: weakest }, rank('you', OLD))).toBe(true);
  });
});

describe('busyInboxView', () => {
  it('counts what the cap kept and left quiet', () => {
    const view = busyInboxView({ busy: true, inboxPrs: 6140, keptByTier: { you: 900, team: 600, others: 0 } }, { updatesLastHour: 300, writesLocked: true });
    expect(view).toEqual({
      busy: true,
      inboxPrs: 6140,
      keptPrs: 1500,
      quietPrs: 4640,
      cap: 1500,
      updatesLastHour: 300,
      writesLocked: true,
      keptYou: 900,
      keptTeam: 600,
      keptOthers: 0,
    });
  });
});
