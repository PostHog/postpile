import { describe, expect, it } from 'vitest';
import type { PrSummary, TileState, TileView, Topic, TopicListItem } from '@postpile/core';
import { at, NO_OPENED_READ, NO_PR_FACTS, withOffers } from '@postpile/core/fixtures';
import type { NavEntry } from './history.ts';
import { applyQueueFilter } from './queues.ts';
import { visibleTopic } from './search.ts';
import {
  autoTile,
  dwellPrKey,
  filterKey,
  heldTopicGone,
  keptFor,
  listedTopics,
  nextHeldTopic,
  nextKept,
  pickedByUser,
  resolveSelection,
  topicClickOutcome,
  topicPickExpired,
  withHeldTopic,
  withSelectedTile,
  type KeptView,
  type UserPick,
} from './selection.ts';

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
    status: { lifecycle: 'open', review: 'review', agentApprovers: [], agentDecline: null, agentVerdict: null, mergeQueue: null, icon: 'open' },
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
    afterRead: { done: false, nothingAsked: false, turn: { kind: 'none', who: null, what: '', prKey: null } },
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
    afterRead: { done: false, nothingAsked: false, turn: { kind: 'none', who: null, what: '', prKey: null } },
    pendingWrite: null,
    quietRepo: false,
    repoLabel: null,
    newestPr: null,
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

/** The user's pick by a click on a tile or PR. */
function tilePick(prKey: string): UserPick {
  return { prKey, fromTopicClick: false };
}

/** The user's pick by a click on a topic, once the topic opened on `prKey`. */
function topicPick(prKey: string): UserPick {
  return { prKey, fromTopicClick: true };
}

describe("dwellPrKey: only the user's pick arms the open-read dwell", () => {
  const tiles = [tile('t1', ['o/r#1'], UNREAD), tile('t2', ['o/r#2'], UNREAD)];

  it("arms for the PR the user picked", () => {
    const selected = resolveSelection(entry('t', 't2', 'o/r#2'), tiles, tiles, null, null);
    expect(dwellPrKey(selected, tilePick('o/r#2'))).toBe('o/r#2');
  });

  it('never arms for the tile the app picks when a topic opens', () => {
    const selected = resolveSelection(entry('t'), tiles, tiles, null, null);
    expect(dwellPrKey(selected, null)).toBeNull();
    // Even when the user had picked that PR before and navigated away since.
    expect(dwellPrKey(selected, tilePick('o/r#1'))).toBeNull();
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
    expect(dwellPrKey(selected, tilePick('o/r#2'))).toBe('o/r#2');
  });

  it('never arms for the next tile the app picks after the picked one left', () => {
    const left = [tiles[0]!];
    const selected = resolveSelection(entry('t', 't2', 'o/r#2'), left, left, null, null);
    expect(selected.view?.tile.id).toBe('t1');
    expect(dwellPrKey(selected, tilePick('o/r#2'))).toBeNull();
  });

  it('never arms for an app pick that turned user-like after a group change while shown', () => {
    const kept = nextKept(null, filterKey(null, null), entry('t'), entry('t', 't1', 'o/r#1'), { group: 'unread' });
    const read = [tile('t1', ['o/r#1'], DONE), tile('t2', ['o/r#2'], UNREAD)];
    const selected = resolveSelection(entry('t'), read, read, null, kept);
    expect(selected.auto).toBe(false);
    expect(dwellPrKey(selected, null)).toBeNull();
  });

  it('arms for the tile a topic click opened on, the app-picked tile included (2026-10-12)', () => {
    const selected = resolveSelection(entry('t'), tiles, tiles, null, null);
    expect([selected.view?.tile.id, selected.auto]).toEqual(['t1', true]);
    expect(dwellPrKey(selected, topicPick('o/r#1'))).toBe('o/r#1');
    expect(pickedByUser(selected, topicPick('o/r#1'))).toBe(true);
  });

  it('keeps the dwell when the tile a topic click opened on turns user-like after its mark', () => {
    const kept = nextKept(null, filterKey(null, null), entry('t'), entry('t', 't1', 'o/r#1'), { group: 'unread' });
    const read = [tile('t1', ['o/r#1'], DONE), tile('t2', ['o/r#2'], UNREAD)];
    const selected = resolveSelection(entry('t'), read, read, null, kept);
    expect([selected.view?.tile.id, selected.auto]).toEqual(['t1', false]);
    expect(dwellPrKey(selected, topicPick('o/r#1'))).toBe('o/r#1');
  });

  it('never carries a topic click over to the next tile the app picks in that topic', () => {
    const left = [tiles[1]!];
    const selected = resolveSelection(entry('t'), left, left, null, null);
    expect([selected.view?.tile.id, selected.auto]).toEqual(['t2', true]);
    expect(dwellPrKey(selected, topicPick('o/r#1'))).toBeNull();
    expect(pickedByUser(selected, topicPick('o/r#1'))).toBe(false);
  });
});

describe('topicPickExpired: a topic click picks once, not again when its PR comes back', () => {
  it('ends a topic click pick once the pane shows another PR (a search first match)', () => {
    expect(topicPickExpired(topicPick('o/r#1'), { prKey: 'o/r#2' })).toBe(true);
    expect(topicPickExpired(topicPick('o/r#1'), { prKey: null })).toBe(true);
  });

  it('keeps it while its PR is on screen', () => {
    expect(topicPickExpired(topicPick('o/r#1'), { prKey: 'o/r#1' })).toBe(false);
  });

  it('leaves tile picks and no pick alone', () => {
    expect(topicPickExpired(tilePick('o/r#1'), { prKey: 'o/r#2' })).toBe(false);
    expect(topicPickExpired(null, { prKey: 'o/r#2' })).toBe(false);
  });
});

describe('topicClickOutcome:a topic click picks the tile it opens on (2026-10-12)', () => {
  const tiles = [tile('t1', ['o/r#1'], UNREAD), tile('t2', ['o/r#2'], UNREAD)];

  it('has nothing to do without a click', () => {
    const selected = resolveSelection(entry('t'), tiles, tiles, null, null);
    expect(topicClickOutcome(null, 't', 't', selected)).toEqual({ done: false, prKey: null });
  });

  it('picks the PR the clicked topic opens on', () => {
    const selected = resolveSelection(entry('t'), tiles, tiles, null, null);
    expect(topicClickOutcome('t', 't', 't', selected)).toEqual({ done: true, prKey: 'o/r#1' });
  });

  it('waits while the clicked topic still loads, then picks its tile', () => {
    const loading = resolveSelection(entry('t'), [], [], null, null);
    expect(topicClickOutcome('t', 't', null, loading)).toEqual({ done: false, prKey: null });
    // The previous topic's tiles never count for the clicked one.
    const previous = resolveSelection(entry('t'), tiles, tiles, null, null);
    expect(topicClickOutcome('t', 't', 'other', previous)).toEqual({ done: false, prKey: null });
    expect(topicClickOutcome('t', 't', 't', previous)).toEqual({ done: true, prKey: 'o/r#1' });
  });

  it('picks the first matching tile while a search narrows the clicked topic', () => {
    const matching = [tiles[1]!];
    const selected = resolveSelection(entry('t'), matching, tiles, new Set(['o/r#2']), null);
    expect(topicClickOutcome('t', 't', 't', selected)).toEqual({ done: true, prKey: 'o/r#2' });
  });

  it('comes to nothing when the topic opens on no tile, so a later app pick does not count', () => {
    const quiet = [tile('t1', ['o/r#1'], DONE)];
    const selected = resolveSelection(entry('t'), quiet, quiet, null, null);
    expect(selected.view).toBeNull();
    expect(topicClickOutcome('t', 't', 't', selected)).toEqual({ done: true, prKey: null });
  });

  it("comes to nothing when another topic shows instead (a filter's first match) or another pane", () => {
    const selected = resolveSelection(entry('t'), tiles, tiles, null, null);
    expect(topicClickOutcome('clicked', 't', 't', selected)).toEqual({ done: true, prKey: null });
    expect(topicClickOutcome('t', null, 't', selected)).toEqual({ done: true, prKey: null });
  });
});

describe('the open topic stays listed after the engine drops it (2026-10-26)', () => {
  /** A one-tile topic with its merged PR unread, as the sidebar listed it before the dwell read. */
  function unreadItem(id: string): TopicListItem {
    return { ...item(id, 0), unreadTiles: 1, unreadPrs: 1, unreadPrKeys: ['o/r#1'], urgentUnreadTiles: 0 };
  }

  it('remembers the listed row of the topic the user is in', () => {
    const docs = unreadItem('docs');
    const items = [item('depot', 1), docs];
    expect(nextHeldTopic(null, items, 'docs', false)).toBe(docs);
    expect(nextHeldTopic(null, items, null, false)).toBeNull();
  });

  it('keeps the row, read, once the topic left the list, and adds it back to the list', () => {
    const docs = unreadItem('docs');
    const afterRead = [item('depot', 1)];
    const held = nextHeldTopic(docs, afterRead, 'docs', false);
    expect(held?.topic.id).toBe('docs');
    // Off the list means nothing unread there: no coral bubble or dot on the kept row.
    expect(held).toMatchObject({ unreadTiles: 0, unreadPrs: 0, unreadPrKeys: [], urgentUnreadTiles: 0 });
    // Settled: the same object again, so the state update stops.
    expect(nextHeldTopic(held, afterRead, 'docs', false)).toBe(held);
    const listed = withHeldTopic(afterRead, held);
    expect(listed.map((row) => row.topic.id)).toEqual(['depot', 'docs']);
    expect(visibleTopic(listed, 'docs', null)?.topic.id).toBe('docs');
    expect(listedTopics(listed, listed, 'docs').map((row) => row.topic.id)).toEqual(['depot', 'docs']);
  });

  it('lets the row go once the user navigates to another topic or pane', () => {
    const held = nextHeldTopic(unreadItem('docs'), [item('depot', 1)], 'docs', false);
    expect(nextHeldTopic(held, [item('depot', 1)], 'depot', false)?.topic.id).toBe('depot');
    expect(nextHeldTopic(held, [item('depot', 1)], null, false)).toBeNull();
  });

  it('lets the row go when the topic is really gone (merged, archived, deleted)', () => {
    const held = nextHeldTopic(unreadItem('docs'), [], 'docs', false);
    expect(nextHeldTopic(held, [], 'docs', true)).toBeNull();
    expect(heldTopicGone({ status: 'active' }, null)).toBe(false);
    expect(heldTopicGone(null, null)).toBe(false);
    expect(heldTopicGone({ status: 'archived' }, null)).toBe(true);
    expect(heldTopicGone({ status: 'retired' }, null)).toBe(true);
    expect(heldTopicGone(null, 404)).toBe(true);
  });

  it('keeps the row through a transient detail failure (offline, server error)', () => {
    expect(heldTopicGone(null, 500)).toBe(false);
    expect(heldTopicGone(null, 503)).toBe(false);
  });

  it('leaves the list as it is while the engine still lists the topic', () => {
    const docs = unreadItem('docs');
    const items = [item('depot', 1), docs];
    expect(withHeldTopic(items, docs)).toBe(items);
    expect(withHeldTopic(items, null)).toBe(items);
  });
});
