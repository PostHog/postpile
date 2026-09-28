import { threadPrKey, type NotificationThread, type PrKey } from '@postpile/core';
import type { Store } from '@postpile/store';
import { NO_LOCAL_CHANGE, type BatchOrigin, type LocalChange, type MarkReadQueue, type PendingBatch, type QueuedThread } from '../mark-read-queue.ts';
import type { ActionLog } from '../writes/action-log.ts';
import { putBackLocalChange } from './local-change.ts';

export const QUEUED_LOCKED_DETAIL = 'GitHub writes are locked: becomes a pending write after the undo window';

/**
 * Marks PRs read, through the deferred queue. Undo inside the window reverts
 * it; after the window GitHub has no way back, so undo reports nothing to undo.
 *
 * GitHub is the source of truth for read and unread:
 * - writes on: the app changes right away (events seen, pinged PRs handled)
 *   and GitHub follows after the undo window.
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

  private unreadThreads(keys: PrKey[]): QueuedThread[] {
    return [...this.store.notifications.getByPrKeys(keys).entries()]
      .filter(([, thread]) => thread.unread)
      .map(([key, thread]) => ({ id: thread.id, updatedAt: thread.updatedAt, prKey: key }));
  }

  private applyLocally(keys: PrKey[], handleKeys: PrKey[]): LocalChange {
    const at = this.now().toISOString();
    const change: LocalChange = { eventIds: [], handledKeys: [] };
    this.store.transaction(() => {
      for (const events of this.store.events.listForPrs(keys).values()) {
        change.eventIds.push(...events.filter((e) => e.seenAt === null).map((e) => e.id));
      }
      this.store.events.markSeen(change.eventIds, at);
      const states = this.store.userPrStates.getMany(keys);
      change.handledKeys = handleKeys.filter((key) => !states.get(key)?.handledAt);
      for (const key of change.handledKeys) {
        this.store.userPrStates.markHandled(key, at);
      }
    });
    return change;
  }

  private logQueued(batch: PendingBatch, threads: QueuedThread[], keys: PrKey[], changedHere: boolean): void {
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

  private enqueueBatch(threads: QueuedThread[], keys: PrKey[], handleKeys: PrKey[], origin: BatchOrigin): PendingBatch {
    const changeHere = this.queue.writesEnabled() || threads.length === 0;
    const local = changeHere ? this.applyLocally(keys, handleKeys) : NO_LOCAL_CHANGE;
    const batch = this.queue.enqueue({ threads, prKeys: keys, handleKeys, local }, origin);
    this.logQueued(batch, threads, keys, changeHere);
    return batch;
  }

  /** Every event of `keys` becomes seen, `handleKeys` also count as done. The batch's token is the undo token. */
  markRead(keys: PrKey[], handleKeys: PrKey[], origin: BatchOrigin): PendingBatch {
    return this.enqueueBatch(this.unreadThreads(keys), keys, handleKeys, origin);
  }

  /**
   * Mark read from the debug view, by thread. A thread of a stored PR is a
   * normal mark-read of that PR; any other thread (issue, release, a PR never
   * synced) only has its GitHub notification to mark.
   */
  markThread(thread: NotificationThread, origin: BatchOrigin): PendingBatch {
    const key = threadPrKey(thread);
    if (key !== null && this.store.prs.get(key)) {
      return this.markRead([key], [key], origin);
    }
    const threads = thread.unread ? [{ id: thread.id, updatedAt: thread.updatedAt, prKey: key }] : [];
    return this.enqueueBatch(threads, [], [], origin);
  }

  /** Null token undoes the newest pending batch. Returns null when nothing is left to undo. */
  undo(token: string | null): PendingBatch | null {
    const batch = this.queue.undo(token);
    if (!batch) {
      return null;
    }
    putBackLocalChange(this.store, batch.local);
    const keys = batch.prKeys.length > 0 ? batch.prKeys : [null];
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
