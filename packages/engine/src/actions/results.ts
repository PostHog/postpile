import type { ActionResult } from '@postpile/core';
import type { PendingBatch } from '../mark-read-queue.ts';

export function ok(message: string, undoToken: string | null = null): ActionResult {
  return { ok: true, message, undoToken };
}

export function failed(message: string): ActionResult {
  return { ok: false, message, undoToken: null };
}

/**
 * "Marked read", or, while GitHub writes are locked, that nothing changes
 * until the write reaches GitHub (it turns pending after the undo window).
 */
export function readMessage(base: string, batch: PendingBatch): string {
  if (batch.writesOn || batch.threadIds.length === 0) {
    return base;
  }
  return `${base}: pending until you unlock GitHub writes, stays unread here until then`;
}
