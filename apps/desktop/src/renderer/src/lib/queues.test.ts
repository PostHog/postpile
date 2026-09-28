import { describe, expect, it } from 'vitest';
import type { PrSummary, PrTier, TileView, Topic, TopicListItem } from '@code-manager/core';
import { at } from '@code-manager/core/fixtures';
import {
  applyQueueFilter,
  filterCounts,
  prMatchesFilter,
  queueLayout,
  tileMatchesFilter,
  tilesInTierOrder,
  unreadLook,
  visibleFaces,
} from './queues.ts';

type Tiers = Partial<Record<PrTier, number>>;

function item(id: string, tiers: Tiers, extra: Partial<TopicListItem> = {}): TopicListItem {
  const topic: Topic = { id, name: id, summary: '', summaryInputHash: null, tailoring: '', driver: null, userRole: 'watcher', status: 'active', area: null, createdAt: at(0), updatedAt: at(0) };
  return {
    topic,
    placement: null,
    statusLine: null,
    group: 'quiet',
    unreadTiles: 0,
    urgentUnreadTiles: 0,
    openTiles: 0,
    totalTiles: 1,
    yourMoveTiles: 0,
    queues: { tiers: { needs_reply: 0, mine: 0, team: 0, to_review: 0, team_mentioned: 0, rest: 0, ...tiers }, byYou: 0, byTeam: 0 },
    people: [],
    ...extra,
  };
}

function pr(overrides: Partial<PrSummary>): PrSummary {
  return {
    key: 'o/r#1',
    title: 'PR',
    url: '',
    author: 'rowan',
    state: 'OPEN',
    isDraft: false,
    provenance: { kind: 'pinged', reason: 'review_requested' },
    why: 'RV',
    tier: 'rest',
    authorRelation: 'other',
    status: { lifecycle: 'open', review: 'review', checks: 'ok' },
    openThreads: 0,
    verdict: null,
    glanceStale: false,
    forYou: null,
    glanceGap: null,
    unseenLoudEvents: 0,
    updatedAt: at(0),
    ...overrides,
  };
}

function tile(id: string, tier: PrTier, prs: PrSummary[] = []): TileView {
  return {
    tile: { id, topicId: 't', kind: 'single', title: id, members: [] },
    state: { kind: 'open', unreadBecause: [] },
    prs,
    why: 'RV',
    tier,
    people: [],
    turn: { kind: 'none', who: null, what: '', prKey: null },
  };
}

describe('queueLayout', () => {
  it('lists a topic in every section it has PRs for and keeps rest-only topics apart', () => {
    const depot = item('depot', { needs_reply: 1, team: 2, rest: 3 });
    const ci = item('ci', { team: 1 });
    const docs = item('docs', { rest: 2 });
    const layout = queueLayout([depot, ci, docs]);
    expect(layout.sections.map((section) => [section.tier, section.count, section.rows.map((row) => [row.item.topic.id, row.count])])).toEqual([
      ['needs_reply', 1, [['depot', 1]]],
      ['team', 3, [['depot', 2], ['ci', 1]]],
    ]);
    expect(layout.other.map((entry) => entry.topic.id)).toEqual(['docs']);
  });
});

describe('queue filters', () => {
  const mine = item('mine', { needs_reply: 1 }, { queues: { tiers: { needs_reply: 1, mine: 0, team: 0, to_review: 0, team_mentioned: 0, rest: 0 }, byYou: 1, byTeam: 0 } });
  const review = item('review', { to_review: 2 }, { queues: { tiers: { needs_reply: 0, mine: 0, team: 0, to_review: 2, team_mentioned: 0, rest: 0 }, byYou: 0, byTeam: 1 } });

  it('counts matching PRs over all topics', () => {
    expect(filterCounts([mine, review])).toEqual({ mine: 1, team: 1, reply: 1, review: 2 });
  });

  it('keeps topics with a matching PR, all without a filter', () => {
    expect(applyQueueFilter([mine, review], 'mine')).toEqual([mine]);
    expect(applyQueueFilter([mine, review], 'review')).toEqual([review]);
    expect(applyQueueFilter([mine, review], null)).toEqual([mine, review]);
  });

  it('matches only open PRs for Mine and Team, and the tier for Reply and Review', () => {
    expect(prMatchesFilter(pr({ authorRelation: 'you' }), 'mine')).toBe(true);
    expect(prMatchesFilter(pr({ authorRelation: 'you', state: 'MERGED' }), 'mine')).toBe(false);
    expect(prMatchesFilter(pr({ authorRelation: 'team' }), 'team')).toBe(true);
    expect(prMatchesFilter(pr({ authorRelation: 'you' }), 'team')).toBe(false);
    expect(prMatchesFilter(pr({ tier: 'needs_reply' }), 'reply')).toBe(true);
    expect(prMatchesFilter(pr({ tier: 'to_review' }), 'reply')).toBe(false);
    expect(tileMatchesFilter(tile('t', 'rest', [pr({}), pr({ tier: 'to_review' })]), 'review')).toBe(true);
  });
});

describe('tilesInTierOrder', () => {
  it('sorts by tier and keeps the order inside a tier', () => {
    const views = [tile('a', 'rest'), tile('b', 'team'), tile('c', 'needs_reply'), tile('d', 'team')];
    expect(tilesInTierOrder(views).map((view) => view.tile.id)).toEqual(['c', 'b', 'd', 'a']);
  });
});

describe('visibleFaces', () => {
  it('shows four faces and counts the rest', () => {
    const people = ['a', 'b', 'c', 'd', 'e', 'f'].map((login) => ({ login, relation: 'other' as const }));
    expect(visibleFaces(people)).toEqual({ shown: people.slice(0, 4), more: 2 });
    expect(visibleFaces(people.slice(0, 2)).more).toBe(0);
  });
});

describe('unreadLook', () => {
  it('is coral only while an unread tile is open', () => {
    expect(unreadLook(item('a', {}, { unreadTiles: 2, urgentUnreadTiles: 1 }))).toBe('urgent');
    expect(unreadLook(item('b', {}, { unreadTiles: 2, urgentUnreadTiles: 0 }))).toBe('calm');
    expect(unreadLook(item('c', {}))).toBeNull();
  });
});
