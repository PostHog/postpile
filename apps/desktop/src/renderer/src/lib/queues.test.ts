import { describe, expect, it } from 'vitest';
import type { PrSummary, PrTier, TileView, Topic, TopicListItem, TopicSection } from '@postpile/core';
import { at, NO_OPENED_READ, NO_PR_FACTS, withOffers } from '@postpile/core/fixtures';
import { holdPlace, placeIn } from './hold-place.ts';
import {
  applyQueueFilter,
  filterCounts,
  prMatchesFilter,
  bucketItems,
  dealtItems,
  sidebarBuckets,
  topicRowId,
  gridGroups,
  headingGroup,
  tilesInTierOrder,
  unreadLook,
  visibleQueueFilters,
} from './queues.ts';

type Tiers = Partial<Record<PrTier, number>>;

/** A topic with these PRs per tier, in the section given (core's `topicSection` in the app). */
function item(id: string, tiers: Tiers, extra: Partial<TopicListItem> = {}, section: TopicSection = 'other_topics'): TopicListItem {
  const topic: Topic = { id, name: id, summary: '', summaryInputHash: null, tailoring: '', driver: null, userRole: 'watcher', status: 'active', kind: 'project', retiredAt: null, area: null, createdAt: at(0), updatedAt: at(0) };
  const queues = { tiers: { needs_reply: 0, changes_requested: 0, mine: 0, team: 0, to_review: 0, team_mentioned: 0, rest: 0, ...tiers }, byYou: 0, byTeam: 0, changesAddressed: 0 };
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
    yourMoves: [], unseenMergeTiles: 0, quiet: false,
    queues,
    section,
    people: [],
    prState: null,
    prStateCounts: { open: 0, merge_queue: 0, merge_queue_failed: 0, draft: 0, merged: 0, closed: 0 },
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
    status: { lifecycle: 'open', review: 'review', agentApprovers: [], mergeQueue: null, icon: 'open' },
    openThreads: 0,
    verdict: null,
    glanceStale: false,
    forYou: null,
    glanceGap: null,
    glanceRefreshBlock: null,
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
  it('keeps the open topic in its section while its selected tile turned done, then lets it move', () => {
    const before = sidebarBuckets([item('cache', { to_review: 1 }, {}, 'to_review'), item('ci', { to_review: 2 }, {}, 'to_review')], true);
    const held = placeIn(before, 'cache', topicRowId);
    // The tile was marked done: the topic has nothing to review any more and goes back to its owner section.
    const after = sidebarBuckets([item('cache', { rest: 1 }, {}, 'you_drive'), item('ci', { to_review: 2 }, {}, 'to_review')], true);

    const shown = holdPlace(after, held, topicRowId);

    expect(bucketItems(shown, 'to_review').map((entry) => entry.topic.id)).toEqual(['cache', 'ci']);
    expect(bucketItems(shown, 'you_drive')).toEqual([]);
    // Once the selection moves, nothing is held and the real layout shows.
    expect(holdPlace(after, null, topicRowId)).toEqual(after);
  });
});

describe('sidebarBuckets', () => {
  it("lists each topic once, in core's section, every section but the Archive in order", () => {
    const depot = item('depot', { needs_reply: 1, team: 2 }, {}, 'needs_reply');
    const own = item('own', { mine: 1 }, {}, 'you_drive');
    const docs = item('docs', { rest: 2 });
    const buckets = sidebarBuckets([docs, own, depot], false);
    expect(buckets.map((bucket) => bucket.key)).toEqual(['needs_reply', 'changes_requested', 'to_review', 'team_mentioned', 'you_drive', 'team_owns', 'other_work', 'other_topics']);
    expect(buckets.filter((bucket) => bucket.items.length > 0).map((bucket) => [bucket.key, bucket.items.map((entry) => entry.topic.id)])).toEqual([
      ['needs_reply', ['depot']],
      ['you_drive', ['own']],
      ['other_topics', ['docs']],
    ]);
  });

  it('lists addressed change requests before ones waiting on the author, else keeps the API order', () => {
    const waiting = item('waiting', { changes_requested: 1 }, {}, 'changes_requested');
    const addressed = withAddressed(item('addressed', { changes_requested: 2 }, {}, 'changes_requested'), 1);
    const alsoWaiting = item('also-waiting', { changes_requested: 1 }, {}, 'changes_requested');
    expect(bucketItems(sidebarBuckets([waiting, addressed, alsoWaiting], false), 'changes_requested').map((entry) => entry.topic.id)).toEqual(['addressed', 'waiting', 'also-waiting']);
  });
});

describe('dealt-with topics', () => {
  const ids = (entries: TopicListItem[]) => entries.map((entry) => entry.topic.id);
  const quiet = (id: string, section: TopicSection) => item(id, { rest: 1 }, { quiet: true }, section);
  const loud = (id: string, section: TopicSection) => item(id, { rest: 1 }, { unreadTiles: 1 }, section);

  it('moves quiet topics of the owner sections to a bucket right after their section', () => {
    const buckets = sidebarBuckets([loud('cache', 'you_drive'), quiet('done', 'you_drive'), quiet('allow', 'team_owns'), quiet('fyi', 'other_topics'), quiet('bills', 'other_work')], true);
    expect(buckets.map((bucket) => bucket.key)).toEqual([
      'needs_reply',
      'changes_requested',
      'to_review',
      'team_mentioned',
      'you_drive',
      'dealt:you_drive',
      'team_owns',
      'dealt:team_owns',
      'other_work',
      'dealt:other_work',
      'other_topics',
    ]);
    expect(ids(bucketItems(buckets, 'you_drive'))).toEqual(['cache']);
    expect(ids(dealtItems(buckets, 'you_drive'))).toEqual(['done']);
    expect(ids(bucketItems(buckets, 'team_owns'))).toEqual([]);
    expect(ids(dealtItems(buckets, 'team_owns'))).toEqual(['allow']);
    expect(ids(dealtItems(buckets, 'other_work'))).toEqual(['bills']);
    // Other topics keeps its quiet rows.
    expect(ids(bucketItems(buckets, 'other_topics'))).toEqual(['fyi']);
  });

  it('shows everything in place while the search or a queue filter narrows', () => {
    const buckets = sidebarBuckets([loud('cache', 'you_drive'), quiet('done', 'you_drive')], false);
    expect(ids(bucketItems(buckets, 'you_drive'))).toEqual(['cache', 'done']);
    expect(dealtItems(buckets, 'you_drive')).toEqual([]);
  });

  it('keeps the selected topic in place when it turns quiet, then lets it go behind the line', () => {
    const before = sidebarBuckets([loud('cache', 'you_drive'), loud('ci', 'you_drive')], true);
    const held = placeIn(before, 'cache', topicRowId);
    const after = sidebarBuckets([quiet('cache', 'you_drive'), loud('ci', 'you_drive')], true);

    const shown = holdPlace(after, held, topicRowId);
    expect(ids(bucketItems(shown, 'you_drive'))).toEqual(['cache', 'ci']);
    expect(dealtItems(shown, 'you_drive')).toEqual([]);
    expect(ids(dealtItems(holdPlace(after, null, topicRowId), 'you_drive'))).toEqual(['cache']);
  });

  it('keeps a selected dealt-with topic behind the line when it gets news, until the selection moves', () => {
    const before = sidebarBuckets([quiet('done', 'team_owns')], true);
    const held = placeIn(before, 'done', topicRowId);
    const after = sidebarBuckets([loud('done', 'team_owns')], true);
    expect(ids(dealtItems(holdPlace(after, held, topicRowId), 'team_owns'))).toEqual(['done']);
    expect(ids(bucketItems(holdPlace(after, null, topicRowId), 'team_owns'))).toEqual(['done']);
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

describe('headingGroup', () => {
  it('names the group its tiles left once none is in it any more: Unread becomes Dealt with when the held tile is read', () => {
    expect(headingGroup('unread', ['dealt_with'])).toBe('dealt_with');
    expect(headingGroup('unread', ['open'])).toBe('open');
    expect(headingGroup('open', ['dealt_with'])).toBe('dealt_with');
  });

  it('stays while any tile under it is still in the group, when the others disagree, or with no tiles', () => {
    expect(headingGroup('unread', ['unread', 'dealt_with'])).toBe('unread');
    expect(headingGroup('unread', ['open', 'dealt_with'])).toBe('unread');
    expect(headingGroup('unread', [])).toBe('unread');
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
