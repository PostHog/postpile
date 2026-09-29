import { describe, expect, it } from 'vitest';
import type { PrSummary, PrTier, TileView, Topic, TopicListItem } from '@postpile/core';
import { at } from '@postpile/core/fixtures';
import {
  applyQueueFilter,
  filterCounts,
  prMatchesFilter,
  queueLayout,
  tileMatchesFilter,
  firstGridTile,
  tilesInTierOrder,
  unreadLook,
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
    primaryAction: 'approve',
    isDraft: false,
    provenance: { kind: 'pinged', reason: 'review_requested' },
    why: 'RV',
    forWhom: { kind: 'you' },
    tier: 'rest',
    authorRelation: 'other',
    status: { lifecycle: 'open', review: 'review', checks: 'ok', agentApprovers: [] },
    openThreads: 0,
    verdict: null,
    glanceStale: false,
    forYou: null,
    glanceGap: null,
    glanceState: 'ready',
    unseenLoudEvents: 0,
    updatedAt: at(0),
    quietRepo: false,
    repoLabel: null,
    ...overrides,
  };
}

function tile(id: string, tier: PrTier, prs: PrSummary[] = []): TileView {
  return {
    tile: { id, topicId: 't', kind: 'single', title: id, members: [], stacks: [] },
    state: { kind: 'open', unreadBecause: [] },
    prs,
    why: 'RV',
    forWhom: { kind: 'you' },
    tier,
    people: [],
    turn: { kind: 'none', who: null, what: '', prKey: null },
    pendingWrite: null,
    quietRepo: false,
    repoLabel: null,
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

  it('puts reviews for you before routed team requests inside To review', () => {
    const routed = { ...tile('routed', 'to_review'), forWhom: { kind: 'team' as const, team: 'team-platform' } };
    const views = [routed, tile('personal', 'to_review'), tile('rest', 'rest'), tile('teammate', 'to_review')];
    expect(tilesInTierOrder(views).map((view) => view.tile.id)).toEqual(['personal', 'teammate', 'routed', 'rest']);
  });
});

describe('firstGridTile', () => {
  it('picks the first live tile in tier order, not the first in API order', () => {
    const done = { ...tile('done', 'needs_reply'), state: { kind: 'done' as const, unreadBecause: [] } };
    const views = [tile('rest', 'rest'), done, tile('team', 'team')];
    expect(firstGridTile(views)?.tile.id).toBe('team');
  });

  it('falls back to snoozed, then done, then nothing', () => {
    const snoozed = { ...tile('snoozed', 'rest'), state: { kind: 'snoozed' as const, unreadBecause: [] } };
    const done = { ...tile('done', 'needs_reply'), state: { kind: 'done' as const, unreadBecause: [] } };
    expect(firstGridTile([done, snoozed])?.tile.id).toBe('snoozed');
    expect(firstGridTile([done])?.tile.id).toBe('done');
    expect(firstGridTile([])).toBeNull();
  });
});

describe('unreadLook', () => {
  it('is coral only while an unread tile is open', () => {
    expect(unreadLook(item('a', {}, { unreadTiles: 2, urgentUnreadTiles: 1 }))).toBe('urgent');
    expect(unreadLook(item('b', {}, { unreadTiles: 2, urgentUnreadTiles: 0 }))).toBe('calm');
    expect(unreadLook(item('c', {}))).toBeNull();
  });
});
