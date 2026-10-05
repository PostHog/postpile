import {
  planRead,
  prReadScope,
  threadPrKey,
  type NotificationThread,
  type PendingThread,
  type PrKey,
  type ReadScope,
  type SubscriptionChange,
} from '@postpile/core';
import type { Store } from '@postpile/store';
import type { BatchOrigin, MarkReadQueue, PendingBatch } from '../mark-read-queue.ts';
import type { ActionLog } from '../writes/action-log.ts';
import { NO_LOCAL_CHANGE, putBackLocalChange, readThreadsLocally, writeReadPlan } from './local-change.ts';

/** The causes that go through the undo queue: a button (tile, PR, Not mine, debug view, Remove team), approve's or a comment review's follow-up, or an open that stayed through the dwell. */
export type QueuedReadCause = { kind: 'button' } | { kind: 'approved' } | { kind: 'opened' };

export const QUEUED_LOCKED_DETAIL = 'GitHub writes are locked: becomes a pending write after the undo window';

/**
 * Marks PRs read, through the deferred queue. Undo inside the window reverts
 * it; after the window GitHub has no way back, so undo reports nothing to undo.
 *
 * GitHub is the source of truth for read and unread:
 * - writes on: the app changes right away (events seen, pinged PRs handled,
 *   the threads read, so the tile turns read with them) and GitHub follows
 *   after the undo window.
 * - writes locked: the app does not change. When the window runs out the
 *   batch becomes a pending write (PendingWrites) that waits for the user to
 *   unlock and send it, or discard it.
 * - nothing unread on GitHub for these PRs: the app changes right away either
 *   way, there is nothing to disagree with.
 *
 * Every queued thread gets an action log row at queue time; PRs without an
 * unread thread get a `local` row when they change here.
 */
export class ReadMarker {
  constructor(
    private readonly store: Store,
    private readonly queue: MarkReadQueue,
    private readonly log: ActionLog,
    private readonly now: () => Date,
  ) {}

  private unreadThreads(keys: PrKey[]): PendingThread[] {
    return [...this.store.notifications.getByPrKeys(keys).entries()]
      .filter(([, thread]) => thread.unread)
      .map(([key, thread]) => ({ id: thread.id, updatedAt: thread.updatedAt, prKey: key }));
  }

  private logQueued(batch: PendingBatch, threads: PendingThread[], keys: PrKey[], changedHere: boolean): void {
    const base = { action: 'mark_read' as const, origin: batch.origin, tileId: batch.tileId, batch: batch.batchId };
    for (const thread of threads) {
      this.log.record({
        ...base,
        threadId: thread.id,
        prKey: thread.prKey,
        outcome: 'queued',
        detail: batch.writesOn ? '' : QUEUED_LOCKED_DETAIL,
      });
    }
    if (!changedHere) {
      return;
    }
    const queuedKeys = new Set(threads.map((thread) => thread.prKey));
    for (const key of keys.filter((candidate) => !queuedKeys.has(candidate))) {
      this.log.record({ ...base, prKey: key, outcome: 'local', detail: 'no unread GitHub thread' });
    }
  }

  /**
   * Plans the read (`planRead`) and, when the app may change right away,
   * writes it. Locked with an unread thread, nothing changes here; the batch
   * keeps the handle keys so the pending write can handle them later.
   */
  private enqueueBatch(threads: PendingThread[], scope: ReadScope, cause: QueuedReadCause, origin: BatchOrigin, subscription: SubscriptionChange | null): PendingBatch {
    const changeHere = this.queue.writesEnabled() || threads.length === 0;
    const at = this.now().toISOString();
    const { handleKeys, local } = this.store.transaction(() => {
      const plan = planRead({
        scope,
        cause,
        events: this.store.events.listForPrs(scope.prKeys),
        userStates: this.store.userPrStates.getMany(scope.prKeys),
        at,
      });
      if (!changeHere) {
        return { handleKeys: plan.handleKeys, local: NO_LOCAL_CHANGE };
      }
      return { handleKeys: plan.handleKeys, local: { ...writeReadPlan(this.store, plan), threads: readThreadsLocally(this.store, threads) } };
    });
    const batch = this.queue.enqueue({ threads, prKeys: scope.prKeys, handleKeys, local, subscription }, origin);
    this.logQueued(batch, threads, scope.prKeys, changeHere);
    return batch;
  }

  /**
   * The scope's events become seen, its handle keys count as done unless the
   * cause says otherwise. The batch's token is the undo token. Mute passes
   * its unsubscribe, which then goes to GitHub with the mark-read.
   */
  markRead(scope: ReadScope, cause: QueuedReadCause, origin: BatchOrigin, subscription: SubscriptionChange | null = null): PendingBatch {
    return this.enqueueBatch(this.unreadThreads(scope.prKeys), scope, cause, origin, subscription);
  }

  /** Unmute's subscribe: nothing to mark read, the same undo window, lock and pending write as a mark-read. */
  changeSubscription(subscription: SubscriptionChange, origin: BatchOrigin): PendingBatch {
    return this.enqueueBatch([], { prKeys: [], handleKeys: [] }, { kind: 'button' }, origin, subscription);
  }

  /**
   * Mark read from the debug view, by thread. A thread of a stored PR is a
   * normal mark-read of that PR; any other thread (issue, release, a PR never
   * synced) only has its GitHub notification to mark.
   */
  markThread(thread: NotificationThread, origin: BatchOrigin): PendingBatch {
    const key = threadPrKey(thread);
    if (key !== null && this.store.prs.get(key)) {
      return this.markRead(prReadScope(key, true), { kind: 'button' }, origin);
    }
    const threads = thread.unread ? [{ id: thread.id, updatedAt: thread.updatedAt, prKey: key }] : [];
    return this.enqueueBatch(threads, { prKeys: [], handleKeys: [] }, { kind: 'button' }, origin, null);
  }

  /** The batch still waits out its undo window. */
  canUndo(token: string): boolean {
    return this.queue.pending().some((batch) => batch.token === token);
  }

  /** Null token undoes the newest pending batch. Returns null when nothing is left to undo. */
  undo(token: string | null): PendingBatch | null {
    const batch = this.queue.undo(token);
    if (!batch) {
      return null;
    }
    putBackLocalChange(this.store, batch.local);
    let keys: (PrKey | null)[] = batch.prKeys;
    if (keys.length === 0) {
      // A thread-only batch (debug view) logs one row by thread; Unmute's batch marks nothing read and logs none.
      keys = batch.threadIds.length > 0 ? [null] : [];
    }
    for (const key of keys) {
      this.log.record({
        action: 'undo_mark_read',
        origin: batch.origin,
        outcome: 'local',
        prKey: key,
        threadId: key === null ? (batch.threadIds[0] ?? null) : null,
        tileId: batch.tileId,
        batch: batch.batchId,
      });
    }
    return batch;
  }
}
