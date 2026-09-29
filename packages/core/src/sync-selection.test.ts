import { describe, expect, it } from 'vitest';
import { selectSyncThreads, syncCutoff, type SyncThread } from './sync-selection.ts';

const NOW = '2026-09-29T12:00:00.000Z';

function thread(key: string, updatedAt: string, unread = true): SyncThread {
  return { key, unread, updatedAt };
}

describe('selectSyncThreads', () => {
  it('puts unread first, newest first inside each, one per PR', () => {
    const picked = selectSyncThreads(
      [
        thread('acme/app#1', '2026-09-20T00:00:00Z'),
        thread('acme/app#2', '2026-09-28T00:00:00Z', false),
        thread('acme/app#3', '2026-09-27T00:00:00Z'),
        thread('acme/app#3', '2026-09-10T00:00:00Z'),
      ],
      new Map(),
      NOW,
    );
    expect(picked.map((t) => t.key)).toEqual(['acme/app#3', 'acme/app#1', 'acme/app#2']);
  });

  it('skips threads older than 30 days and PRs fetched since their last activity', () => {
    const picked = selectSyncThreads(
      [thread('acme/app#1', '2026-08-01T00:00:00Z'), thread('acme/app#2', '2026-09-20T00:00:00Z'), thread('acme/app#3', '2026-09-21T00:00:00Z')],
      new Map([['acme/app#2', '2026-09-25T00:00:00Z']]),
      NOW,
    );
    expect(picked.map((t) => t.key)).toEqual(['acme/app#3']);
  });

  it('cuts off exactly 30 days back', () => {
    expect(syncCutoff(NOW)).toBe('2026-08-30T12:00:00.000Z');
  });
});
