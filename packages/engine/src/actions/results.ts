import type { ActionResult } from '@code-manager/core';
import type { PendingBatch } from '../mark-read-queue.ts';

export function ok(message: string, undoToken: string | null = null): ActionResult {
  return { ok: true, message, undoToken };
}

export function failed(message: string): ActionResult {
  return { ok: false, message, undoToken: null };
}

/** "Marked read", plus a note when the batch stays in the app because GitHub writes are off. */
export function readMessage(base: string, batch: PendingBatch): string {
  return batch.writesOn ? base : `${base} here only (GitHub writes are off)`;
}
