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
export function readMessage(base: string, batch: Pick<PendingBatch, 'writesOn' | 'threadIds'>): string {
  if (batch.writesOn || batch.threadIds.length === 0) {
    return base;
  }
  return `${base}: pending until you unlock GitHub writes, stays unread here until then`;
}

/** Mute's toast: what reaches GitHub and when (after the undo window, or once writes are unlocked). */
export function muteMessage(batch: { writesOn: boolean; subscription: object | null }): string {
  if (batch.subscription === null) {
    return "Muted until you're mentioned. No GitHub notification thread to unsubscribe from";
  }
  if (!batch.writesOn) {
    return "Muted until you're mentioned. Unsubscribing on GitHub is pending until you unlock GitHub writes";
  }
  return "Muted until you're mentioned. Unsubscribed on GitHub in a few seconds";
}

/** Unmute's toast: subscribing again on GitHub, after the undo window or once writes are unlocked. */
export function unmuteMessage(batch: Pick<PendingBatch, 'writesOn'>): string {
  if (!batch.writesOn) {
    return 'Unmuted. Subscribing you again on GitHub is pending until you unlock GitHub writes';
  }
  return 'Unmuted. Subscribed again on GitHub in a few seconds';
}
