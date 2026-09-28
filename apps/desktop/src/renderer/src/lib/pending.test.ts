import { describe, expect, it } from 'vitest';
import type { PendingWriteView } from '@postpile/core';
import { pendingHeadline, pendingList } from './pending.ts';

function write(id: number, error: string | null = null): PendingWriteView {
  return { id, kind: 'mark_read', createdAt: '2026-09-28T10:00:00Z', origin: 'tile', title: `PR ${id}`, prKeys: [`o/r#${id}`], tileId: null, threadCount: 1, error };
}

describe('pending writes in the lock popover', () => {
  it('lists the first few and counts the rest', () => {
    const pending = [1, 2, 3, 4, 5, 6, 7].map((id) => write(id));
    expect(pendingList(pending, 5).shown.map((entry) => entry.id)).toEqual([1, 2, 3, 4, 5]);
    expect(pendingList(pending, 5).more).toBe(2);
    expect(pendingList(pending.slice(0, 2), 5).more).toBe(0);
  });

  it('says how many and how many failed', () => {
    expect(pendingHeadline([write(1)])).toBe('1 pending mark-read');
    expect(pendingHeadline([write(1), write(2, 'boom')])).toBe('2 pending mark-reads (1 failed)');
  });
});
