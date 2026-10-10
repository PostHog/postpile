import { describe, expect, it } from 'vitest';
import type { PrSummary, TileState, TileView, Topic, TopicListItem } from '@postpile/core';
import { at, NO_OPENED_READ, NO_PR_FACTS, withOffers } from '@postpile/core/fixtures';
import type { NavEntry } from './history.ts';
import { applyQueueFilter } from './queues.ts';
import { visibleTopic } from './search.ts';
import { autoTile, dwellPrKey, filterKey, keptFor, listedTopics, nextKept, resolveSelection, withSelectedTile, type KeptView } from './selection.ts';

/** A topic with `mine` open PRs of the viewer's. */
function item(id: string, mine: number): TopicListItem {
  const topic: Topic = { id, name: id, summary: '', summaryInputHash: null, tailoring: '', driver: null, userRole: 'watcher', status: 'active', kind: 'project', retiredAt: null, area: null, createdAt: at(0), updatedAt: at(0) };
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
    queues: { tiers: { needs_reply: 0, changes_requested: 0, mine, team: 0, to_review: 0, team_mentioned: 0, rest: 0 }, byYou: mine, byTeam: 0, changesAddressed: 0 },
    section: mine > 0 ? 'you_drive' : 'other_topics',
    people: [],
    prState: null,
    prStateCounts: { open: 0, merge_queue: 0, merge_queue_failed: 0, draft: 0, merged: 0, closed: 0 },
  };
}

function pr(key: string): PrSummary {
  return {
    key,
    title: key,
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
    fetchedAt: null,
    quietRepo: false,
    repoLabel: null,
  };
}

function tile(id: string, prKeys: string[], state: TileState = { kind: 'open', unreadBecause: [], unreadOnGitHub: false, loud: false }): TileView {
  return withOffers({
    tile: { id, topicId: 't', kind: 'single', title: id, members: [], stacks: [] },
    state,
    prs: prKeys.map(pr),
    why: 'RV',
    forWhom: { kind: 'you' },
    tier: 'rest',
    people: [],
    turn: { kind: 'none', who: null, what: '', prKey: null },
    landableBelow: [],
    afterRead: { done: false, turn: { kind: 'none', who: null, what: '', prKey: null } },
    pendingWrite: null,
    quietRepo: false,
    repoLabel: null,
  });
}

function entry(topicId: string | null, tileId: string | null = null, prKey: string | null = null): NavEntry {
  return { pane: 'topic', topicId, tileId, prKey };
}

const DONE: TileState = { kind: 'done', unreadBecause: [], unreadOnGitHub: false, loud: false };
const UNREAD: TileState = { kind: 'unread', unreadBecause: [], unreadOnGitHub: true, loud: true };

describe('topic stickiness under a queue filter', () => {
  const review = filterKey('mine', null);
  const picked = entry('b');

  it('keeps the picked topic after a refetch drops it from the filter', () => {
    const before = [item('a', 1), item('b', 1)];
    const kept = nextKept(null, review, picked, { ...picked, topicId: 'b' });
    // Merging b's only open PR of yours: b leaves "my PRs", the filter key stays.
    const after = [item('a', 1), item('b', 0)];
    const shown = applyQueueFilter(after, 'mine');
    expect(visibleTopic(before, 'b', applyQueueFilter(before, 'mine'))?.topic.id).toBe('b');
    expect(visibleTopic(after, 'b', shown, keptFor(kept, picked, review)?.topicId ?? null)?.topic.id).toBe('b');
    expect(listedTopics(after, shown, 'b').map((listed) => listed.topic.id)).toEqual(['a', 'b']);
  });

  it('falls back to the first match when the user changes the filter', () => {
    const kept = nextKept(null, review, picked, picked);
    const after = [item('a', 1), item('b', 0)];
    const team = filterKey('team', null);
    expect(keptFor(kept, picked, team)).toBeNull();
    expect(visibleTopic(after, 'b', applyQueueFilter(after, 'mine'), keptFor(kept, picked, team)?.topicId ?? null)?.topic.id).toBe('a');
  });

  it('drops the kept view on a new pick or when the topic is gone', () => {
    const kept = nextKept(null, review, picked, picked);
    expect(keptFor(kept, entry('a'), review)).toBeNull();
    const gone = [item('a', 1)];
    expect(visibleTopic(gone, 'b', applyQueueFilter(gone, 'mine'), 'b')?.topic.id).toBe('a');
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
});

describe('autoTile and the auto selection', () => {
  const SNOOZED: TileState = { kind: 'snoozed', unreadBecause: [], unreadOnGitHub: false, loud: false };
  const SNOOZED_UNREAD: TileState = { kind: 'snoozed', unreadBecause: [], unreadOnGitHub: true, loud: false };

  it('selects the first tile of the Unread group', () => {
    const tiles = [tile('open', ['o/r#1']), tile('unread', ['o/r#2'], UNREAD), tile('done', ['o/r#3'], DONE)];
    expect(autoTile(tiles)?.tile.id).toBe('unread');
  });

  it('falls back to the first tile of the Open group', () => {
    const tiles = [tile('done', ['o/r#3'], DONE), tile('open', ['o/r#1'])];
    expect(autoTile(tiles)?.tile.id).toBe('open');
  });

  it('never selects a tile in Dealt with or a snoozed one, unread or not', () => {
    const tiles = [tile('done', ['o/r#3'], DONE), tile('snoozed', ['o/r#4'], SNOOZED), tile('snoozed-unread', ['o/r#5'], SNOOZED_UNREAD)];
    expect(autoTile(tiles)).toBeNull();
  });

  it('marks the fallback as auto and a pick as not', () => {
    const tiles = [tile('t1', ['o/r#1'], UNREAD), tile('t2', ['o/r#2'])];
    expect(resolveSelection(entry('t'), tiles, tiles, null, null).auto).toBe(true);
    expect(resolveSelection(entry('t', 't2', 'o/r#2'), tiles, tiles, null, null).auto).toBe(false);
  });

  it('selects nothing when only tiles in Dealt with are left', () => {
    const tiles = [tile('t1', ['o/r#1'], DONE)];
    expect(resolveSelection(entry('t'), tiles, tiles, null, null)).toEqual({ view: null, prKey: null, auto: false });
  });

  it('stays auto while the kept auto pick keeps its group', () => {
    const tiles = [tile('t1', ['o/r#1'], UNREAD)];
    const kept = nextKept(null, filterKey(null, null), entry('t'), entry('t', 't1', 'o/r#1'), { group: 'unread' });
    expect(resolveSelection(entry('t'), tiles, tiles, null, kept).auto).toBe(true);
  });

  it('turns into a user-like pick once the auto tile changes group while shown', () => {
    const kept = nextKept(null, filterKey(null, null), entry('t'), entry('t', 't1', 'o/r#1'), { group: 'unread' });
    const read = [tile('t1', ['o/r#1'], DONE), tile('t2', ['o/r#2'], UNREAD)];
    const selected = resolveSelection(entry('t'), read, read, null, kept);
    expect([selected.view?.tile.id, selected.auto]).toEqual(['t1', false]);
  });
});

describe("dwellPrKey: only the user's pick arms the open-read dwell", () => {
  const tiles = [tile('t1', ['o/r#1'], UNREAD), tile('t2', ['o/r#2'], UNREAD)];

  it("arms for the PR the user picked", () => {
    const selected = resolveSelection(entry('t', 't2', 'o/r#2'), tiles, tiles, null, null);
    expect(dwellPrKey(selected, 'o/r#2')).toBe('o/r#2');
  });

  it('never arms for the tile the app picks when a topic opens', () => {
    const selected = resolveSelection(entry('t'), tiles, tiles, null, null);
    expect(dwellPrKey(selected, null)).toBeNull();
    // Even when the user had picked that PR before and navigated away since.
    expect(dwellPrKey(selected, 'o/r#1')).toBeNull();
  });

  it("never arms for search's first match, also for a half-typed query (BOARD-A-02)", () => {
    const matching = [tiles[1]!];
    const selected = resolveSelection(entry('t'), matching, tiles, new Set(['o/r#2']), null);
    expect([selected.view?.tile.id, selected.auto]).toEqual(['t2', true]);
    expect(dwellPrKey(selected, null)).toBeNull();
  });

  it("arms once the user clicks a search result", () => {
    const matching = [tiles[1]!];
    const selected = resolveSelection(entry('t', 't2', 'o/r#2'), matching, tiles, new Set(['o/r#2']), null);
    expect(dwellPrKey(selected, 'o/r#2')).toBe('o/r#2');
  });

  it('never arms for the next tile the app picks after the picked one left', () => {
    const left = [tiles[0]!];
    const selected = resolveSelection(entry('t', 't2', 'o/r#2'), left, left, null, null);
    expect(selected.view?.tile.id).toBe('t1');
    expect(dwellPrKey(selected, 'o/r#2')).toBeNull();
  });

  it('never arms for an app pick that turned user-like after a group change while shown', () => {
    const kept = nextKept(null, filterKey(null, null), entry('t'), entry('t', 't1', 'o/r#1'), { group: 'unread' });
    const read = [tile('t1', ['o/r#1'], DONE), tile('t2', ['o/r#2'], UNREAD)];
    const selected = resolveSelection(entry('t'), read, read, null, kept);
    expect(selected.auto).toBe(false);
    expect(dwellPrKey(selected, null)).toBeNull();
  });
});
