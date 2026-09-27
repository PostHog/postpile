import type { PrKey } from '@code-manager/core';
import type { Store } from '@code-manager/store';
import type { MarkReadQueue, PendingBatch } from '../mark-read-queue.ts';

/** What a mark-read changed locally, so an undo can put it back. */
interface LocalChange {
  eventIds: string[];
  handledKeys: PrKey[];
}

/**
 * Marks PRs read: locally right away (events seen, optionally handled), on
 * GitHub through the deferred queue. Undo inside the window reverts both;
 * after the window GitHub has no way back, so undo reports nothing to undo.
 */
export class ReadMarker {
  private readonly changes = new Map<string, LocalChange>();

  constructor(
    private readonly store: Store,
    private readonly queue: MarkReadQueue,
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

  private unreadThreadIds(keys: PrKey[]): string[] {
    return [...this.store.notifications.getByPrKeys(keys).values()].filter((t) => t.unread).map((t) => t.id);
  }

  /** Every event of `keys` becomes seen, `handleKeys` also count as done. Returns the undo token. */
  markRead(keys: PrKey[], handleKeys: PrKey[]): string {
    this.forgetSent();
    const at = this.now().toISOString();
    const change: LocalChange = { eventIds: [], handledKeys: [] };
    this.store.transaction(() => {
      for (const events of this.store.events.listForPrs(keys).values()) {
        change.eventIds.push(...events.filter((e) => e.seenAt === null).map((e) => e.id));
      }
      this.store.events.markSeen(change.eventIds, at);
      const states = this.store.userPrStates.getMany(handleKeys);
      change.handledKeys = handleKeys.filter((key) => !states.get(key)?.handledAt);
      for (const key of change.handledKeys) {
        this.store.userPrStates.markHandled(key, at);
      }
    });
    const batch = this.queue.enqueue(this.unreadThreadIds(keys), keys);
    this.changes.set(batch.token, change);
    return batch.token;
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
    return batch;
  }
}
