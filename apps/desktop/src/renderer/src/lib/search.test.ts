import { describe, expect, it } from 'vitest';
import type { SearchResult, Topic, TopicListItem, TopicSection } from '@postpile/core';
import { filterTopics, searchFilter, sidebarOrder, visibleTopic } from './search.ts';

function item(id: string, unreadTiles: number, section: TopicSection = 'other_topics'): TopicListItem {
  const at = '2026-09-27T00:00:00.000Z';
  const topic: Topic = { id, name: id, summary: '', summaryInputHash: null, tailoring: '', driver: null, userRole: 'watcher', status: 'active', kind: 'project', retiredAt: null, area: null, createdAt: at, updatedAt: at };
  return { topic, placement: null, statusLine: null, group: unreadTiles > 0 ? 'needs_you' : 'quiet', unreadTiles,
    unreadPrs: unreadTiles,
    unreadPrKeys: [],
    urgentUnreadTiles: unreadTiles,
    openTiles: 0,
    totalTiles: 1,
    yourMoves: [], unseenMergeTiles: 0,
    queues: { tiers: { needs_reply: 0, changes_requested: 0, mine: 0, team: 0, to_review: 0, team_mentioned: 0, rest: 1 }, byYou: 0, byTeam: 0, changesAddressed: 0 },
    section,
    people: [],
    prState: null,
    prStateCounts: { open: 0, merge_queue: 0, merge_queue_failed: 0, draft: 0, merged: 0, closed: 0 },
  };
}

// The API lists quiet-a first; the sidebar lists loud's section (You drive) above Other topics.
const items = [item('quiet-a', 0), item('loud', 2, 'you_drive'), item('quiet-b', 0)];

function result(topics: Record<string, string[]>): SearchResult {
  return { query: 'q', topics: Object.entries(topics).map(([topicId, tileIds]) => ({ topicId, tileIds, prKeys: [] })) };
}

describe('searchFilter', () => {
  it('is null without an answer and counts matching tiles', () => {
    expect(searchFilter(undefined)).toBeNull();
    const filter = searchFilter(result({ loud: ['t1', 't2'], 'quiet-b': ['t3'] }));
    expect(filter?.tileCount).toBe(3);
    expect(filter?.tilesByTopic.get('loud')).toEqual(new Set(['t1', 't2']));
    expect(searchFilter({ query: 'q', topics: [{ topicId: 'a', tileIds: ['t'], prKeys: ['o/r#1'] }] })?.prKeys).toEqual(new Set(['o/r#1']));
  });
});

describe('filterTopics', () => {
  it('keeps matching topics in order, or all without a filter', () => {
    expect(filterTopics(items, null)).toBe(items);
    expect(filterTopics(items, searchFilter(result({ 'quiet-b': ['x'], 'quiet-a': ['y'] }))).map((i) => i.topic.id)).toEqual(['quiet-a', 'quiet-b']);
  });
});

describe('sidebarOrder', () => {
  it('lists topics section by section, in API order inside one', () => {
    expect(sidebarOrder(items).map((i) => i.topic.id)).toEqual(['loud', 'quiet-a', 'quiet-b']);
  });

  it('puts ask sections first and lists a topic once', () => {
    const queued = { ...item('queued', 0), queues: { tiers: { needs_reply: 1, changes_requested: 0, mine: 1, team: 0, to_review: 0, team_mentioned: 0, rest: 0 }, byYou: 1, byTeam: 0, changesAddressed: 0 }, section: 'needs_reply' as const };
    expect(sidebarOrder([...items, queued]).map((i) => i.topic.id)).toEqual(['queued', 'loud', 'quiet-a', 'quiet-b']);
  });

  it('lists Other work by its area folds, single-topic areas last under More', () => {
    const work = (id: string, area: string | null) => {
      const entry = item(id, 0, 'other_work');
      return { ...entry, topic: { ...entry.topic, area } };
    };
    const order = sidebarOrder([work('lone', 'SDK'), work('ci-a', 'CI'), work('none', null), work('ci-b', 'CI')]);
    expect(order.map((i) => i.topic.id)).toEqual(['ci-a', 'ci-b', 'lone', 'none']);
  });
});

describe('visibleTopic', () => {
  it('keeps the pick while it matches', () => {
    expect(visibleTopic(items, 'quiet-b', null)?.topic.id).toBe('quiet-b');
    expect(visibleTopic(items, 'quiet-b', filterTopics(items, searchFilter(result({ 'quiet-b': ['x'] }))))?.topic.id).toBe('quiet-b');
  });

  it('falls back to the first match in sidebar order when the pick is filtered out', () => {
    const filter = searchFilter(result({ 'quiet-a': ['x'], loud: ['y'] }));
    expect(visibleTopic(items, 'quiet-b', filterTopics(items, filter))?.topic.id).toBe('loud');
  });

  it('shows nothing when nothing matches, the sidebar\'s first topic without a pick', () => {
    expect(visibleTopic(items, 'loud', filterTopics(items, searchFilter(result({}))))).toBeNull();
    // API order starts with quiet-a; the sidebar puts the loud topic first.
    expect(visibleTopic(items, null, null)?.topic.id).toBe('loud');
  });
});
