import { describe, expect, it } from 'vitest';
import type { SearchResult, Topic, TopicListItem } from '@code-manager/core';
import { filterTopics, searchFilter, sidebarOrder, visibleTopic } from './search.ts';

function item(id: string, unreadTiles: number): TopicListItem {
  const at = '2026-09-27T00:00:00.000Z';
  const topic: Topic = { id, name: id, summary: '', summaryInputHash: null, tailoring: '', driver: null, userRole: 'watcher', status: 'active', area: null, createdAt: at, updatedAt: at };
  return { topic, placement: null, statusLine: null, group: unreadTiles > 0 ? 'needs_you' : 'quiet', unreadTiles, openTiles: 0, totalTiles: 1 };
}

const items = [item('quiet-a', 0), item('loud', 2), item('quiet-b', 0)];

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
  it('lists unread topics first like the sidebar', () => {
    expect(sidebarOrder(items).map((i) => i.topic.id)).toEqual(['loud', 'quiet-a', 'quiet-b']);
  });
});

describe('visibleTopic', () => {
  it('keeps the pick while it matches', () => {
    expect(visibleTopic(items, 'quiet-b', null)?.topic.id).toBe('quiet-b');
    expect(visibleTopic(items, 'quiet-b', searchFilter(result({ 'quiet-b': ['x'] })))?.topic.id).toBe('quiet-b');
  });

  it('falls back to the first match in sidebar order when the pick is filtered out', () => {
    const filter = searchFilter(result({ 'quiet-a': ['x'], loud: ['y'] }));
    expect(visibleTopic(items, 'quiet-b', filter)?.topic.id).toBe('loud');
  });

  it('shows nothing when nothing matches, the first topic without a pick', () => {
    expect(visibleTopic(items, 'loud', searchFilter(result({})))).toBeNull();
    expect(visibleTopic(items, null, null)?.topic.id).toBe('quiet-a');
  });
});
