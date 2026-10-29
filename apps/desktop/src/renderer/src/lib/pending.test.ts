import { describe, expect, it } from 'vitest';
import type { PendingWriteView } from '@postpile/core';
import { pendingHeadline, pendingList, queueText } from './pending.ts';

function write(id: number, error: string | null = null, kind: PendingWriteView['kind'] = 'mark_read'): PendingWriteView {
  return { id, kind, createdAt: '2026-09-28T10:00:00Z', origin: 'tile', title: `PR ${id}`, prKeys: [`o/r#${id}`], tileId: null, threadCount: 1, error };
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

  it('names follows and mutes, and says writes when the kinds differ', () => {
    expect(pendingHeadline([write(1, null, 'follow')])).toBe('1 pending follow');
    expect(pendingHeadline([write(1, null, 'unsubscribe'), write(2, null, 'unsubscribe')])).toBe('2 pending mutes');
    expect(pendingHeadline([write(1), write(2, null, 'follow')])).toBe('2 pending writes');
    expect(pendingHeadline([write(1, null, 'catch_up'), write(2)])).toBe('2 pending mark-reads');
  });
});

describe('queueText', () => {
  it('counts the undo window first, then writes waiting in the lock, else says nothing', () => {
    expect(queueText(2, 3)).toBe('2 mark-read in the undo window');
    expect(queueText(0, 3)).toBe('3 pending, send from the lock');
    expect(queueText(0, 0)).toBeNull();
  });
});
