import { describe, expect, it } from 'vitest';
import type { PrSummary, TileState, TileView, Topic, TopicListItem } from '@postpile/core';
import { at } from '@postpile/core/fixtures';
import type { NavEntry } from './history.ts';
import { applyQueueFilter } from './queues.ts';
import { visibleTopic } from './search.ts';
import { autoTile, filterKey, noSelectionText, keptFor, listedTopics, nextKept, resolveSelection, unreadTiles, withSelectedTile, type KeptView } from './selection.ts';

function item(id: string, toReview: number): TopicListItem {
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
    yourMoves: [], unseenMergeTiles: 0,
    queues: { tiers: { needs_reply: 0, changes_requested: 0, mine: 0, team: 0, to_review: toReview, team_mentioned: 0, rest: 0 }, byYou: 0, byTeam: 0, changesAddressed: 0 },
    people: [],
  };
}

function pr(key: string): PrSummary {
  return {
    key,
    title: key,
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
    status: { lifecycle: 'open', review: 'review', agentApprovers: [] },
    openThreads: 0,
    verdict: null,
    glanceStale: false,
    forYou: null,
    glanceGap: null,
    glanceState: 'ready',
    unseenLoudEvents: 0,
    done: false,
    ownTeamRequests: [],
    pendingWrite: null,
    turn: { kind: 'none', who: null, what: '', prKey: null },
    afterRead: { done: false, turn: { kind: 'none', who: null, what: '', prKey: null } },
    whatsNew: null,
    updatedAt: at(0),
    quietRepo: false,
    repoLabel: null,
  };
}

function tile(id: string, prKeys: string[], state: TileState = { kind: 'open', unreadBecause: [] }): TileView {
  return {
    tile: { id, topicId: 't', kind: 'single', title: id, members: [], stacks: [] },
    state,
    prs: prKeys.map(pr),
    why: 'RV',
    forWhom: { kind: 'you' },
    tier: 'rest',
    people: [],
    turn: { kind: 'none', who: null, what: '', prKey: null },
    afterRead: { done: false, turn: { kind: 'none', who: null, what: '', prKey: null } },
    pendingWrite: null,
    quietRepo: false,
    repoLabel: null,
  };
}

function entry(topicId: string | null, tileId: string | null = null, prKey: string | null = null): NavEntry {
  return { pane: 'topic', topicId, tileId, prKey };
}

const DONE: TileState = { kind: 'done', unreadBecause: [] };
const UNREAD: TileState = { kind: 'unread', unreadBecause: [] };

describe('topic stickiness under a queue filter', () => {
  const review = filterKey('review', null);
  const picked = entry('b');

  it('keeps the picked topic after a refetch drops it from the filter', () => {
    const before = [item('a', 1), item('b', 1)];
    const kept = nextKept(null, review, picked, { ...picked, topicId: 'b' });
    // Approving b's only review: b leaves Review, the filter key stays.
    const after = [item('a', 1), item('b', 0)];
    const shown = applyQueueFilter(after, 'review');
    expect(visibleTopic(before, 'b', applyQueueFilter(before, 'review'))?.topic.id).toBe('b');
    expect(visibleTopic(after, 'b', shown, keptFor(kept, picked, review)?.topicId ?? null)?.topic.id).toBe('b');
    expect(listedTopics(after, shown, 'b').map((listed) => listed.topic.id)).toEqual(['a', 'b']);
  });

  it('falls back to the first match when the user changes the filter', () => {
    const kept = nextKept(null, review, picked, picked);
    const after = [item('a', 1), item('b', 0)];
    const mine = filterKey('mine', null);
    expect(keptFor(kept, picked, mine)).toBeNull();
    expect(visibleTopic(after, 'b', applyQueueFilter(after, 'review'), keptFor(kept, picked, mine)?.topicId ?? null)?.topic.id).toBe('a');
  });

  it('drops the kept view on a new pick or when the topic is gone', () => {
    const kept = nextKept(null, review, picked, picked);
    expect(keptFor(kept, entry('a'), review)).toBeNull();
    const gone = [item('a', 1)];
    expect(visibleTopic(gone, 'b', applyQueueFilter(gone, 'review'), 'b')?.topic.id).toBe('a');
  });

  it('keys the search by the query its results answer', () => {
    expect(filterKey(null, 'depot')).not.toBe(filterKey(null, 'dep'));
    expect(filterKey(null, null)).toBe(filterKey(null, null));
  });
});

describe('nextKept', () => {
  const key = filterKey(null, null);

  it('returns the same object when nothing changed', () => {
    const kept = nextKept(null, key, entry('a'), entry('a', 't1', 'o/r#1'));
    expect(nextKept(kept, key, entry('a'), entry('a', 't1', 'o/r#1'))).toBe(kept);
  });

  it('keeps the last tile while the tiles load and on another pane', () => {
    const kept = nextKept(null, key, entry('a'), entry('a', 't1', 'o/r#1'));
    expect(nextKept(kept, key, entry('a'), entry('a'))).toBe(kept);
    expect(nextKept(kept, key, { ...entry('a'), pane: 'inbox' }, entry('a'))).toBe(kept);
  });
});

describe('resolveSelection', () => {
  const kept = (tileId: string, prKey: string): KeptView => ({ filterKey: '|', entry: entry('t'), topicId: 't', tileId, prKey });

  it('keeps the picked tile and PR', () => {
    const tiles = [tile('t1', ['o/r#1']), tile('t2', ['o/r#2', 'o/r#3'])];
    const selected = resolveSelection(entry('t', 't2', 'o/r#3'), tiles, tiles, null, null);
    expect([selected.view?.tile.id, selected.prKey]).toEqual(['t2', 'o/r#3']);
  });

  it('follows the picked PR to the tile that holds it now', () => {
    // #3 left set t2 and is a single tile now; the first tile would be t1.
    const tiles = [tile('t1', ['o/r#1']), tile('t2', ['o/r#2']), tile('t3', ['o/r#3'])];
    const selected = resolveSelection(entry('t', 'old-set', 'o/r#3'), tiles, tiles, null, null);
    expect([selected.view?.tile.id, selected.prKey]).toEqual(['t3', 'o/r#3']);
  });

  it('keeps a tile that became done', () => {
    const tiles = [tile('t1', ['o/r#1']), tile('t2', ['o/r#2'], DONE)];
    expect(resolveSelection(entry('t', 't2', 'o/r#2'), tiles, tiles, null, null).view?.tile.id).toBe('t2');
  });

  it('keeps the kept tile when a refetch drops it from the search', () => {
    const all = [tile('t1', ['o/r#1']), tile('t2', ['o/r#2'])];
    const matching = [all[0]!];
    const selected = resolveSelection(entry('t'), matching, all, new Set(['o/r#1']), kept('t2', 'o/r#2'));
    expect([selected.view?.tile.id, selected.prKey]).toEqual(['t2', 'o/r#2']);
  });

  it('falls back to the first tile when the PR is gone too', () => {
    const tiles = [tile('t1', ['o/r#1'])];
    expect(resolveSelection(entry('t', 'gone', 'o/r#9'), tiles, tiles, null, null).view?.tile.id).toBe('t1');
    expect(resolveSelection(entry('t'), [], [], null, null)).toEqual({ view: null, prKey: null, auto: false });
  });
});

describe('grid helpers', () => {
  it('adds the selected tile to the search matches', () => {
    expect(withSelectedTile(null, 't1')).toBeNull();
    expect(withSelectedTile(new Set(['t1']), 't2')).toEqual(new Set(['t1', 't2']));
  });

  it('keeps the selected tile in the Unread list after it is read', () => {
    const tiles = [tile('t1', ['o/r#1'], UNREAD), tile('t2', ['o/r#2']), tile('t3', ['o/r#3'])];
    expect(unreadTiles(tiles, 't2').map((view) => view.tile.id)).toEqual(['t1', 't2']);
    expect(unreadTiles(tiles, null).map((view) => view.tile.id)).toEqual(['t1']);
  });
});

describe('autoTile and the auto selection', () => {
  const UNREAD: TileState = { kind: 'unread', unreadBecause: [] };
  const SNOOZED = { kind: 'snoozed' } as unknown as TileState;

  it('selects the first unread tile', () => {
    const tiles = [tile('open', ['o/r#1']), tile('unread', ['o/r#2'], UNREAD), tile('done', ['o/r#3'], DONE)];
    expect(autoTile(tiles, 'all')?.tile.id).toBe('unread');
    expect(autoTile(tiles, 'unread')?.tile.id).toBe('unread');
  });

  it('falls back to the first open tile under All only', () => {
    const tiles = [tile('done', ['o/r#3'], DONE), tile('open', ['o/r#1'])];
    expect(autoTile(tiles, 'all')?.tile.id).toBe('open');
    expect(autoTile(tiles, 'unread')).toBeNull();
  });

  it('never selects a done or snoozed tile', () => {
    const tiles = [tile('done', ['o/r#3'], DONE), tile('snoozed', ['o/r#4'], SNOOZED)];
    expect(autoTile(tiles, 'all')).toBeNull();
    expect(autoTile(tiles, 'unread')).toBeNull();
  });

  it('marks the fallback as auto and a pick as not', () => {
    const tiles = [tile('t1', ['o/r#1'], UNREAD), tile('t2', ['o/r#2'])];
    expect(resolveSelection(entry('t'), tiles, tiles, null, null, 'all').auto).toBe(true);
    expect(resolveSelection(entry('t', 't2', 'o/r#2'), tiles, tiles, null, null, 'all').auto).toBe(false);
  });

  it('selects nothing under Unread when only done tiles are left', () => {
    const tiles = [tile('t1', ['o/r#1'], DONE)];
    expect(resolveSelection(entry('t'), tiles, tiles, null, null, 'unread')).toEqual({ view: null, prKey: null, auto: false });
  });

  it('stays auto while the kept auto pick keeps its state', () => {
    const tiles = [tile('t1', ['o/r#1'], UNREAD)];
    const kept = nextKept(null, filterKey(null, null), entry('t'), entry('t', 't1', 'o/r#1'), { tileFilter: 'all', state: 'unread' });
    expect(resolveSelection(entry('t'), tiles, tiles, null, kept, 'all').auto).toBe(true);
  });

  it('turns into a user-like pick once the auto tile changes state while shown', () => {
    const kept = nextKept(null, filterKey(null, null), entry('t'), entry('t', 't1', 'o/r#1'), { tileFilter: 'unread', state: 'unread' });
    const read = [tile('t1', ['o/r#1'], DONE), tile('t2', ['o/r#2'], UNREAD)];
    const selected = resolveSelection(entry('t'), read, read, null, kept, 'unread');
    expect([selected.view?.tile.id, selected.auto]).toEqual(['t1', false]);
  });

  it('picks again when the grid filter changes under an auto pick', () => {
    const tiles = [tile('open', ['o/r#1']), tile('unread', ['o/r#2'], UNREAD)];
    const kept = nextKept(null, filterKey(null, null), entry('t'), entry('t', 'open', 'o/r#1'), { tileFilter: 'all', state: 'open' });
    expect(resolveSelection(entry('t'), tiles, tiles, null, kept, 'unread').view?.tile.id).toBe('unread');
    const onlyOpen = [tile('open', ['o/r#1'])];
    expect(resolveSelection(entry('t'), onlyOpen, onlyOpen, null, kept, 'unread').view).toBeNull();
  });

  it('keeps a user pick across a grid filter change', () => {
    const tiles = [tile('open', ['o/r#1'])];
    const kept = nextKept(null, filterKey(null, null), entry('t', 'open', 'o/r#1'), entry('t', 'open', 'o/r#1'));
    expect(resolveSelection(entry('t', 'open', 'o/r#1'), tiles, tiles, null, kept, 'unread').view?.tile.id).toBe('open');
  });

  it('words the empty pane by filter', () => {
    expect(noSelectionText('unread')).toBe('Nothing unread in this topic. Pick a tile, or show All.');
    expect(noSelectionText('all')).toBe('Pick a tile to see it.');
  });
});
