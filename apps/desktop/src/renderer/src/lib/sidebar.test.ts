import { describe, expect, it } from 'vitest';
import type { Topic, TopicListItem, TopicPlacement } from '@postpile/core';
import { areaFolds, foldedSummary, isNotSorted, otherTopicsGroups, rowsWhileFolded, startsOpen } from './sidebar.ts';

function topic(id: string, area: string | null): Topic {
  const at = '2026-09-27T00:00:00.000Z';
  return { id, name: id, summary: '', summaryInputHash: null, tailoring: '', driver: null, userRole: 'watcher', status: 'active', kind: 'project', retiredAt: null, area, createdAt: at, updatedAt: at };
}

interface Extra {
  area?: string | null;
  placement?: Partial<TopicPlacement> | null;
  unread?: number;
  urgent?: number;
  byYou?: number;
  moves?: number;
}

function item(id: string, extra: Extra = {}): TopicListItem {
  const placement = extra.placement === undefined ? {} : extra.placement;
  return {
    topic: topic(id, extra.area ?? null),
    placement: placement === null ? null : { relation: 'team', ownerTeam: null, whyYou: '', area: extra.area ?? null, corrected: false, ...placement },
    statusLine: null,
    group: (extra.urgent ?? 0) > 0 ? 'needs_you' : 'quiet',
    unreadTiles: extra.unread ?? 0,
    unreadPrs: extra.unread ?? 0,
    unreadPrKeys: [],
    urgentUnreadTiles: extra.urgent ?? 0,
    openTiles: 0,
    totalTiles: 1,
    yourMoves: Array.from({ length: extra.moves ?? 0 }, () => ({ move: 'review' as const, text: 'Review' })),
    unseenMergeTiles: 0,
    queues: { tiers: { needs_reply: 0, changes_requested: 0, mine: 0, team: 0, to_review: 0, team_mentioned: 0, rest: 1 }, byYou: extra.byYou ?? 0, byTeam: 0, changesAddressed: 0 },
    section: 'other_work',
    people: [],
    prState: null,
    prStateCounts: { open: 0, merge_queue: 0, merge_queue_failed: 0, draft: 0, merged: 0, closed: 0 },
  };
}

const ids = (items: TopicListItem[]) => items.map((entry) => entry.topic.id);

describe('areaFolds', () => {
  it('gives areas with two or more topics their own fold, alphabetically, the rest under More', () => {
    const folds = areaFolds([item('lone', { area: 'SDK' }), item('ci-a', { area: 'CI' }), item('new', { area: null }), item('ci-b', { area: 'CI' }), item('cache', { area: 'Build' }), item('turbo', { area: 'Build' })]);
    expect(folds.map((fold) => [fold.key, fold.label, ids(fold.items)])).toEqual([
      ['area:Build', 'Build', ['cache', 'turbo']],
      ['area:CI', 'CI', ['ci-a', 'ci-b']],
      ['more', 'More', ['lone', 'new']],
    ]);
  });

  it('has no More fold when every area has company', () => {
    expect(areaFolds([item('a', { area: 'CI' }), item('b', { area: 'CI' })]).map((fold) => fold.label)).toEqual(['CI']);
  });
});

describe('otherTopicsGroups', () => {
  it('lists topics nothing places open and FYI apart; no dossier is not sorted yet', () => {
    const groups = otherTopicsGroups([item('new', { placement: null }), item('desktop', { placement: { relation: 'fyi' } }), item('routed', { placement: { relation: 'routed' } })]);
    expect(ids(groups.unplaced)).toEqual(['new', 'routed']);
    expect(ids(groups.fyi)).toEqual(['desktop']);
    expect(groups.unplaced.map(isNotSorted)).toEqual([true, false]);
  });
});

describe('Other work folds', () => {
  it("start open for the viewer's open PR, a move or an unread topic, else folded", () => {
    expect(startsOpen([item('quiet')])).toBe(false);
    expect(startsOpen([item('quiet'), item('pr', { byYou: 1 })])).toBe(true);
    expect(startsOpen([item('move', { moves: 1 })])).toBe(true);
    expect(startsOpen([item('news', { unread: 1 })])).toBe(true);
  });

  it('keep urgent unread rows while folded and say what is unread', () => {
    const items = [item('quiet'), item('calm', { unread: 2 }), item('urgent', { unread: 1, urgent: 1 })];
    expect(ids(rowsWhileFolded(items))).toEqual(['urgent']);
    expect(foldedSummary(items)).toBe('· 2 unread · 1 urgent');
    expect(foldedSummary([item('calm', { unread: 1 })])).toBe('· 1 unread');
    expect(foldedSummary([item('quiet')])).toBe('');
  });
});
