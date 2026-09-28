import { threadPrKey, type NotificationThread, type PrKey } from '@postpile/core';
import type { Store } from '@postpile/store';
import type { BatchOrigin, MarkReadQueue, PendingBatch, QueuedThread } from '../mark-read-queue.ts';
import type { ActionLog } from '../writes/action-log.ts';
import { WRITES_OFF_DETAIL } from '../writes/github-writes.ts';

/** What a mark-read changed locally, so an undo can put it back. */
interface LocalChange {
  eventIds: string[];
  handledKeys: PrKey[];
}

/**
 * Marks PRs read: locally right away (events seen, optionally handled), on
 * GitHub through the deferred queue. Undo inside the window reverts both;
 * after the window GitHub has no way back, so undo reports nothing to undo.
 *
 * While GitHub writes are off the batch still goes through the queue (so
 * undo works the same), but it only ever changes the app. Every PR and
 * thread gets an action log row at queue time: queued, or local.
 */
export class ReadMarker {
  private readonly changes = new Map<string, LocalChange>();

  constructor(
    private readonly store: Store,
    private readonly queue: MarkReadQueue,
    private readonly log: ActionLog,
    private readonly now: () => Date,
  ) {}

  private forgetSent(): void {
    const pending = new Set(this.queue.pending().map((batch) => batch.token));
    for (const token of this.changes.keys()) {
      if (!pending.has(token)) {
        this.changes.delete(token);
      }
    }
  }

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

  /** One row per queued thread, and one per PR that had no unread thread to queue. */
  private logQueued(batch: PendingBatch, threads: QueuedThread[], keys: PrKey[]): void {
    const base = { action: 'mark_read' as const, origin: batch.origin, tileId: batch.tileId, batch: batch.batchId };
    for (const thread of threads) {
      this.log.record({
        ...base,
        threadId: thread.id,
        prKey: thread.prKey,
        outcome: batch.writesOn ? 'queued' : 'local',
        detail: batch.writesOn ? '' : WRITES_OFF_DETAIL,
      });
    }
    const queuedKeys = new Set(threads.map((thread) => thread.prKey));
    for (const key of keys.filter((candidate) => !queuedKeys.has(candidate))) {
      this.log.record({ ...base, prKey: key, outcome: 'local', detail: 'no unread GitHub thread' });
    }
  }

  private queueAndRemember(threads: QueuedThread[], keys: PrKey[], change: LocalChange, origin: BatchOrigin): PendingBatch {
    const batch = this.queue.enqueue(threads, keys, origin);
    this.changes.set(batch.token, change);
    this.logQueued(batch, threads, keys);
    return batch;
  }

  /** Every event of `keys` becomes seen, `handleKeys` also count as done. The batch's token is the undo token. */
  markRead(keys: PrKey[], handleKeys: PrKey[], origin: BatchOrigin): PendingBatch {
    this.forgetSent();
    const change = this.applyLocally(keys, handleKeys);
    return this.queueAndRemember(this.unreadThreads(keys), keys, change, origin);
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
    this.forgetSent();
    const change: LocalChange = { eventIds: [], handledKeys: [] };
    const threads = thread.unread ? [{ id: thread.id, updatedAt: thread.updatedAt, prKey: key }] : [];
    return this.queueAndRemember(threads, [], change, origin);
  }

  /** Null token undoes the newest pending batch. Returns null when nothing is left to undo. */
  undo(token: string | null): PendingBatch | null {
    const batch = this.queue.undo(token);
    if (!batch) {
      return null;
    }
    const change = this.changes.get(batch.token);
    this.changes.delete(batch.token);
    if (change) {
      this.store.transaction(() => {
        this.store.events.clearSeen(change.eventIds);
        for (const key of change.handledKeys) {
          this.store.userPrStates.clearHandled(key);
        }
      });
    }
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
