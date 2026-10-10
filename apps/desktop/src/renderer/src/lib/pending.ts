import type { PendingWriteView } from '@postpile/core';

/** How many pending writes the lock popover lists before "+N more". */
const PENDING_LIST_MAX = 5;

/** The first few pending writes for the lock popover, and how many are left out. */
export function pendingList(pending: PendingWriteView[], max: number = PENDING_LIST_MAX): { shown: PendingWriteView[]; more: number } {
  return { shown: pending.slice(0, max), more: Math.max(pending.length - max, 0) };
}

/** "1 pending mark-read", "3 pending mark-reads (1 failed)". */
export function pendingHeadline(pending: PendingWriteView[]): string {
  const failed = pending.filter((write) => write.error !== null).length;
  const noun = pending.length === 1 ? 'mark-read' : 'mark-reads';
  return `${pending.length} pending ${noun}${failed > 0 ? ` (${failed} failed)` : ''}`;
}

/** Hover text for the lock's count badge. */
export function pendingBadgeTitle(pending: PendingWriteView[]): string {
  return `${pendingHeadline(pending)}: made while GitHub writes were locked. They reach GitHub only once you send them from here; until then the tiles stay unread.`;
}

/**
 * The footer's right-hand queue item: mark-reads in the 6s undo window, then
 * writes waiting in the lock, else nothing (an "empty" item read as "nothing
 * is waiting" while the lock still held writes).
 */
export function queueText(undoWindow: number, pendingInLock: number): string | null {
  if (undoWindow > 0) {
    return `${undoWindow} mark-read in the undo window`;
  }
  return pendingInLock > 0 ? `${pendingInLock} pending, send from the lock` : null;
}
