import { describe, expect, it } from 'vitest';
import type { PrSummary, PrTier, TileView, Topic, TopicListItem } from '@postpile/core';
import { at, NO_OPENED_READ, NO_PR_FACTS, withOffers } from '@postpile/core/fixtures';
import { holdPlace, placeIn } from './hold-place.ts';
import {
  applyQueueFilter,
  filterCounts,
  prMatchesFilter,
  layoutBuckets,
  layoutFromBuckets,
  queueLayout,
  queueRowId,
  gridGroups,
  tilesInTierOrder,
  unreadLook,
  visibleQueueFilters,
} from './queues.ts';

type Tiers = Partial<Record<PrTier, number>>;

function item(id: string, tiers: Tiers, extra: Partial<TopicListItem> = {}): TopicListItem {
  const topic: Topic = { id, name: id, summary: '', summaryInputHash: null, tailoring: '', driver: null, userRole: 'watcher', status: 'active', retiredAt: null, area: null, createdAt: at(0), updatedAt: at(0) };
  return {
    topic,
    placement: null,
    statusLine: null,
    group: 'quiet',
    unreadTiles: 0,
    unreadPrs: 0,
    unreadPrKeys: [],
    urgentUnreadTiles: 0,
    openTiles: 0,
    totalTiles: 1,
    yourMoves: [], unseenMergeTiles: 0,
    queues: { tiers: { needs_reply: 0, changes_requested: 0, mine: 0, team: 0, to_review: 0, team_mentioned: 0, rest: 0, ...tiers }, byYou: 0, byTeam: 0, changesAddressed: 0 },
    people: [],
    prState: null,
    prStateCounts: { open: 0, draft: 0, merged: 0, closed: 0 },
    ...extra,
  };
}

function pr(overrides: Partial<PrSummary>): PrSummary {
  return {
    key: 'o/r#1',
    title: 'PR',
    url: '',
    author: 'rowan',
    assignees: [],
    state: 'OPEN',
    primaryAction: 'approve',
    isDraft: false,
    provenance: { kind: 'pinged', reason: 'review_requested' },
    why: 'RV',
    forWhom: { kind: 'you' },
    tier: 'rest',
    authorRelation: 'other',
    status: { lifecycle: 'open', review: 'review', agentApprovers: [] },
    openThreads: 0,
    verdict: null,
    glanceStale: false,
    forYou: null,
    glanceGap: null,
    glanceState: 'ready',
    unseenLoudEvents: 0,
    unreadOnGitHub: false,
    done: false,
    ownTeamRequests: [],
    pendingWrite: null,
    turn: { kind: 'none', who: null, what: '', prKey: null },
    facts: NO_PR_FACTS,
    afterRead: { done: false, turn: { kind: 'none', who: null, what: '', prKey: null } },
    openedRead: NO_OPENED_READ,
    whatsNew: null,
    updatedAt: at(0),
    quietRepo: false,
    repoLabel: null,
    ...overrides,
  };
}

function tile(id: string, tier: PrTier, prs: PrSummary[] = []): TileView {
  return withOffers({
    tile: { id, topicId: 't', kind: 'single', title: id, members: [], stacks: [] },
    state: { kind: 'open', unreadBecause: [], unreadOnGitHub: false, loud: false },
    prs,
    why: 'RV',
    forWhom: { kind: 'you' },
    tier,
    people: [],
    turn: { kind: 'none', who: null, what: '', prKey: null },
    afterRead: { done: false, turn: { kind: 'none', who: null, what: '', prKey: null } },
    pendingWrite: null,
    quietRepo: false,
    repoLabel: null,
  });
}

function withAddressed(entry: TopicListItem, changesAddressed: number): TopicListItem {
  return { ...entry, queues: { ...entry.queues, changesAddressed } };
}

describe('holding the open topic row in place', () => {
  it('round-trips a layout through its buckets', () => {
    const layout = queueLayout([item('depot', { needs_reply: 1 }), item('docs', { rest: 1 })]);
    expect(layoutFromBuckets(layoutBuckets(layout))).toEqual(layout);
  });

  it('keeps the open topic in its section while its selected tile turned done, then lets it move', () => {
    const before = queueLayout([item('cache', { to_review: 1 }), item('ci', { to_review: 2 })]);
    const held = placeIn(layoutBuckets(before), 'cache', queueRowId);
    // The tile was marked done: the topic has nothing to review any more and would drop to Other topics.
    const after = queueLayout([item('cache', { rest: 1 }), item('ci', { to_review: 2 })]);

    const shown = layoutFromBuckets(holdPlace(layoutBuckets(after), held, queueRowId));

    expect(shown.sections.map((section) => [section.tier, section.rows.map((row) => row.item.topic.id), section.count])).toEqual([['to_review', ['cache', 'ci'], 2]]);
    expect(shown.other).toEqual([]);
    // Once the selection moves, nothing is held and the real layout shows.
    expect(layoutFromBuckets(holdPlace(layoutBuckets(after), null, queueRowId))).toEqual(after);
  });
});

describe('queueLayout', () => {
  it('lists each topic once, in its highest section, and keeps rest-only topics apart', () => {
    const depot = item('depot', { needs_reply: 1, team: 2, rest: 3 });
    const ci = item('ci', { team: 1 });
    const docs = item('docs', { rest: 2 });
    const layout = queueLayout([depot, ci, docs]);
    expect(layout.sections.map((section) => [section.tier, section.count, section.rows.map((row) => [row.item.topic.id, row.count])])).toEqual([
      ['needs_reply', 1, [['depot', 1]]],
      ['team', 1, [['ci', 1]]],
    ]);
    expect(layout.other.map((entry) => entry.topic.id)).toEqual(['docs']);
  });

  it('lets a mixed topic follow the work: your PR never pulls it above what other PRs ask', () => {
    const devbox = item('devbox', { mine: 2, to_review: 1 });
    const runners = item('runners', { mine: 1, team: 1 });
    const app = item('app', { mine: 3, rest: 2 });
    const layout = queueLayout([devbox, runners, app]);
    expect(layout.sections.map((section) => [section.tier, section.rows.map((row) => row.item.topic.id)])).toEqual([
      ['mine', ['app']],
      ['team', ['runners']],
      ['to_review', ['devbox']],
    ]);
  });

  it('puts Changes you requested under Needs reply and above My PRs', () => {
    const cache = item('cache', { changes_requested: 1, mine: 2 });
    const own = item('own', { mine: 1 });
    const layout = queueLayout([own, cache]);
    expect(layout.sections.map((section) => [section.tier, section.rows.map((row) => [row.item.topic.id, row.count])])).toEqual([
      ['changes_requested', [['cache', 1]]],
      ['mine', [['own', 1]]],
    ]);
  });

  it('lists addressed change requests before ones waiting on the author, else keeps the API order', () => {
    const waiting = item('waiting', { changes_requested: 1 });
    const addressed = withAddressed(item('addressed', { changes_requested: 2 }), 1);
    const alsoWaiting = item('also-waiting', { changes_requested: 1 });
    const layout = queueLayout([waiting, addressed, alsoWaiting]);
    expect(layout.sections[0]?.rows.map((row) => row.item.topic.id)).toEqual(['addressed', 'waiting', 'also-waiting']);
  });
});

describe('queue filters', () => {
  const mine = item('mine', { needs_reply: 1 }, { queues: { tiers: { needs_reply: 1, changes_requested: 0, mine: 0, team: 0, to_review: 0, team_mentioned: 0, rest: 0 }, byYou: 1, byTeam: 0, changesAddressed: 0 } });
  const review = item('review', { to_review: 2 }, { queues: { tiers: { needs_reply: 0, changes_requested: 0, mine: 0, team: 0, to_review: 2, team_mentioned: 0, rest: 0 }, byYou: 0, byTeam: 1, changesAddressed: 0 } });

  it('counts open PRs of yours and of your team over all topics', () => {
    expect(filterCounts([mine, review])).toEqual({ mine: 1, team: 1 });
  });

  it('keeps topics with a matching PR, all without a filter', () => {
    expect(applyQueueFilter([mine, review], 'mine')).toEqual([mine]);
    expect(applyQueueFilter([mine, review], 'team')).toEqual([review]);
    expect(applyQueueFilter([mine, review], null)).toEqual([mine, review]);
  });

  it('matches only open PRs, yours for my PRs and a teammate\'s for team PRs', () => {
    expect(prMatchesFilter(pr({ authorRelation: 'you' }), 'mine')).toBe(true);
    expect(prMatchesFilter(pr({ authorRelation: 'you', state: 'MERGED' }), 'mine')).toBe(false);
    expect(prMatchesFilter(pr({ authorRelation: 'team' }), 'team')).toBe(true);
    expect(prMatchesFilter(pr({ authorRelation: 'you' }), 'team')).toBe(false);
  });

  it('never matches a pulled-in stack layer', () => {
    const layer = pr({ authorRelation: 'team', provenance: { kind: 'pulled_in', reason: 'stack layer below #2' } });
    expect(prMatchesFilter(layer, 'team')).toBe(false);
  });

  it('never matches a PR in a quiet repo', () => {
    expect(prMatchesFilter(pr({ authorRelation: 'you', quietRepo: true }), 'mine')).toBe(false);
  });
});

describe('tilesInTierOrder', () => {
  it('sorts by tier and keeps the order inside a tier', () => {
    const views = [tile('a', 'rest'), tile('b', 'team'), tile('c', 'needs_reply'), tile('d', 'team')];
    expect(tilesInTierOrder(views).map((view) => view.tile.id)).toEqual(['c', 'b', 'd', 'a']);
  });

  it('puts your move before tiles waiting on the author inside Changes you requested', () => {
    const waiting = { ...tile('waiting', 'changes_requested'), turn: { kind: 'them' as const, who: 'ada', what: 'to address 1 thread', prKey: 'o/r#1' } };
    const addressed = { ...tile('addressed', 'changes_requested'), turn: { kind: 'you' as const, move: 're_review' as const, who: null, what: 'ada addressed your changes: re-review', prKey: 'o/r#2' } };
    const views = [tile('mine', 'mine'), waiting, addressed];
    expect(tilesInTierOrder(views).map((view) => view.tile.id)).toEqual(['addressed', 'waiting', 'mine']);
  });

  it('puts reviews for you before routed team requests inside To review', () => {
    const routed = { ...tile('routed', 'to_review'), forWhom: { kind: 'team' as const, team: 'team-platform' } };
    const views = [routed, tile('personal', 'to_review'), tile('rest', 'rest'), tile('teammate', 'to_review')];
    expect(tilesInTierOrder(views).map((view) => view.tile.id)).toEqual(['personal', 'teammate', 'routed', 'rest']);
  });
});

describe('gridGroups', () => {
  const state = (kind: 'unread' | 'open' | 'snoozed' | 'done', unreadOnGitHub = false) => ({ kind, unreadBecause: [], unreadOnGitHub, loud: false });
  const grouped = (views: TileView[]) => gridGroups(views).map((bucket) => [bucket.key, bucket.items.map((view) => view.tile.id)]);

  it('groups by core\'s group in the order Unread, Open, Dealt with, tier order inside', () => {
    const views = [
      withOffers({ ...tile('done', 'needs_reply'), state: state('done') }),
      withOffers({ ...tile('rest-unread', 'rest'), state: state('unread', true) }),
      tile('open', 'rest'),
      withOffers({ ...tile('team-unread', 'team'), state: state('unread', true) }),
    ];
    expect(grouped(views)).toEqual([
      ['unread', ['team-unread', 'rest-unread']],
      ['open', ['open']],
      ['dealt_with', ['done']],
    ]);
  });

  it('puts your own tiles first in every group, then tier order', () => {
    const yours = pr({ authorRelation: 'you' });
    const views = [tile('review', 'to_review'), tile('own', 'rest', [yours]), withOffers({ ...tile('own-unread', 'mine', [yours]), state: state('unread', true) }), withOffers({ ...tile('reply', 'needs_reply'), state: state('unread', true) })];
    expect(grouped(views)).toEqual([
      ['unread', ['own-unread', 'reply']],
      ['open', ['own', 'review']],
      ['dealt_with', []],
    ]);
  });

  it('keeps empty groups for the held place and puts snoozed tiles last in their group', () => {
    const views = [withOffers({ ...tile('snoozed', 'needs_reply'), state: state('snoozed') }), tile('open', 'rest')];
    expect(grouped(views)).toEqual([
      ['unread', []],
      ['open', ['open', 'snoozed']],
      ['dealt_with', []],
    ]);
  });
});

describe('unreadLook', () => {
  it('is coral only while an unread tile is open', () => {
    expect(unreadLook(item('a', {}, { unreadTiles: 2, urgentUnreadTiles: 1 }))).toBe('urgent');
    expect(unreadLook(item('b', {}, { unreadTiles: 2, urgentUnreadTiles: 0 }))).toBe('calm');
    expect(unreadLook(item('c', {}))).toBeNull();
  });
});

describe('visibleQueueFilters', () => {
  it('hides Team without a home team, unless it is the active filter', () => {
    expect(visibleQueueFilters(['acme/team-devex'], null)).toEqual(['mine', 'team']);
    expect(visibleQueueFilters(null, null)).toEqual(['mine', 'team']);
    expect(visibleQueueFilters([], null)).toEqual(['mine']);
    expect(visibleQueueFilters([], 'team')).toEqual(['mine', 'team']);
  });
});
