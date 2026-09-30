import type { LivePollStatus, TopicListItem } from '@postpile/core';
import { OFF_POLL_STATUS } from '@postpile/core';
import { describe, expect, it } from 'vitest';
import { BoardWatcher, type BoardSnapshot } from './board-watcher.ts';

function topic(moves: number): TopicListItem {
  const yourMoves = Array.from({ length: moves }, () => ({ move: 'review' as const, text: 'Review' }));
  return { yourMoves } as unknown as TopicListItem;
}

function setup(topics: TopicListItem[]) {
  const seen: BoardSnapshot[] = [];
  const state = { topics, reads: 0 };
  const reader = {
    listTopics: async () => {
      state.reads += 1;
      return state.topics;
    },
    unreadPrKeys: async () => ['acme/app#1'],
  };
  const errors: unknown[] = [];
  const watcher = new BoardWatcher(reader, (snapshot) => seen.push(snapshot), (error) => errors.push(error));
  return { watcher, seen, state, errors };
}

function status(overrides: Partial<LivePollStatus>): LivePollStatus {
  return { ...OFF_POLL_STATUS, ...overrides };
}

describe('BoardWatcher', () => {
  it('sums your moves across topics and passes the unread PRs', async () => {
    const { watcher, seen } = setup([topic(2), topic(0), topic(3)]);
    await watcher.refresh();
    expect(seen).toEqual([{ yourMoves: 5, unreadPrKeys: ['acme/app#1'] }]);
  });

  it('reads again only when the live status moved', async () => {
    const { watcher, state } = setup([topic(1)]);
    await watcher.checkStatus(status({ changeCount: 1 }));
    await watcher.checkStatus(status({ changeCount: 1 }));
    expect(state.reads).toBe(1);
    await watcher.checkStatus(status({ changeCount: 2 }));
    await watcher.checkStatus(status({ changeCount: 2, syncRunning: true }));
    expect(state.reads).toBe(3);
  });

  it('runs once more when asked during a read', async () => {
    const { watcher, state } = setup([topic(1)]);
    await Promise.all([watcher.refresh(), watcher.refresh(), watcher.refresh()]);
    expect(state.reads).toBe(2);
  });

  it('reports a failing read and keeps going', async () => {
    const { watcher, state, errors, seen } = setup([topic(1)]);
    state.topics = null as unknown as TopicListItem[];
    await watcher.refresh();
    expect(errors).toHaveLength(1);
    state.topics = [topic(1)];
    await watcher.refresh();
    expect(seen).toHaveLength(1);
  });
});
