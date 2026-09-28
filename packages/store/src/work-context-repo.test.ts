import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WorkContextInputStats, WorkContextVersion } from '@code-manager/core';
import { at } from '@code-manager/core/fixtures';
import { Store, WORK_CONTEXT_VERSIONS_KEPT } from './index.ts';

let store: Store;

beforeEach(() => {
  store = Store.open(':memory:');
});

afterEach(() => {
  store.close();
});

const stats: WorkContextInputStats = {
  budgetChars: 60_000,
  sentChars: 1200,
  claudeMdFiles: 1,
  memoryFiles: 2,
  sessions: 3,
  sessionFilesScanned: 4,
  maskedSecrets: 1,
  droppedCount: 1,
  dropped: [{ kind: 'session', ref: 'old · 2026-09-01', reason: 'over budget' }],
};

function entry(summary: string, createdAt: string): Omit<WorkContextVersion, 'version'> {
  return {
    digest: {
      summary,
      threads: [{ title: 'Depot', detail: 'Moving CI.', topicIds: ['topic-1'], sources: [{ kind: 'memory', ref: '~/.claude/projects/p/memory/depot.md' }] }],
      lastSeenAt: createdAt,
    },
    inputSources: [{ kind: 'memory', ref: '~/.claude/projects/p/memory/depot.md' }],
    inputStats: stats,
    model: 'opus',
    createdAt,
  };
}

describe('WorkContextRepo', () => {
  it('stores versions with sources and stats, and reads the newest back', () => {
    expect(store.workContext.latest()).toBeNull();
    store.workContext.add(entry('first', at(1)));
    const second = store.workContext.add(entry('second', at(2)));

    expect(second.version).toBe(2);
    expect(store.workContext.latest()).toEqual(second);
    expect(store.workContext.get(1)?.digest.summary).toBe('first');
    expect(store.workContext.latest()?.inputStats.dropped[0]?.reason).toBe('over budget');
  });

  it(`keeps the newest ${WORK_CONTEXT_VERSIONS_KEPT} versions`, () => {
    for (let i = 1; i <= WORK_CONTEXT_VERSIONS_KEPT + 3; i++) {
      store.workContext.add(entry(`v${i}`, at(i)));
    }
    expect(store.workContext.count()).toBe(WORK_CONTEXT_VERSIONS_KEPT);
    expect(store.workContext.get(3)).toBeNull();
    expect(store.workContext.get(4)?.digest.summary).toBe('v4');
    expect(store.workContext.latest()?.version).toBe(WORK_CONTEXT_VERSIONS_KEPT + 3);
  });
});
