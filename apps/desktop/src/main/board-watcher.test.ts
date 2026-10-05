import type { LivePollStatus } from '@postpile/core';
import { OFF_POLL_STATUS } from '@postpile/core';
import { describe, expect, it } from 'vitest';
import { BoardWatcher, type BoardSnapshot } from './board-watcher.ts';

function setup(badge: number) {
  const seen: BoardSnapshot[] = [];
  const state = { badge, failing: false, reads: 0 };
  const reader = {
    pingBadge: async () => {
      state.reads += 1;
      if (state.failing) {
        throw new Error('read failed');
      }
      return state.badge;
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
  it('passes the ping badge and the unread PRs', async () => {
    const { watcher, seen } = setup(2);
    await watcher.refresh();
    expect(seen).toEqual([{ badge: 2, unreadPrKeys: ['acme/app#1'] }]);
  });

  it('reads again only when the live status moved', async () => {
    const { watcher, state } = setup(1);
    await watcher.checkStatus(status({ changeCount: 1 }));
    await watcher.checkStatus(status({ changeCount: 1 }));
    expect(state.reads).toBe(1);
    await watcher.checkStatus(status({ changeCount: 2 }));
    await watcher.checkStatus(status({ changeCount: 2, syncRunning: true }));
    expect(state.reads).toBe(3);
  });

  it('runs once more when asked during a read', async () => {
    const { watcher, state } = setup(1);
    await Promise.all([watcher.refresh(), watcher.refresh(), watcher.refresh()]);
    expect(state.reads).toBe(2);
  });

  it('reports a failing read and keeps going', async () => {
    const { watcher, state, errors, seen } = setup(1);
    state.failing = true;
    await watcher.refresh();
    expect(errors).toHaveLength(1);
    state.failing = false;
    await watcher.refresh();
    expect(seen).toHaveLength(1);
  });
});
