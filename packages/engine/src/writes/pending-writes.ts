import type { GitHubWritesStatus, PendingThread, PendingWrite, PendingWriteView, PendingWritesResult, PrKey, TilePendingWrite } from '@postpile/core';
import type { Store } from '@postpile/store';
import type { MarkReadQueue, ParkedBatch, ThreadOutcome } from '../mark-read-queue.ts';
import type { GitHubWrites } from './github-writes.ts';

export const PENDING_DETAIL = 'GitHub writes are locked: waits until you unlock and send it';
export const DISCARDED_DETAIL = 'discarded while locked: stays unread, like on GitHub';

/**
 * Mark-reads made while GitHub writes are locked. GitHub is the source of
 * truth for read and unread, so a locked mark-read changes nothing in the
 * app. When its undo window runs out it is stored here (pending_write) and
 * logged as `pending`; the tile keeps its state and shows a marker. The user
 * sends them when unlocking (the PRs turn read here as each thread reaches
 * GitHub; failures stay pending with the error), or discards them (nothing
 * changes, the tiles stay unread like GitHub has them).
 */
export class PendingWrites {
  constructor(
    private readonly store: Store,
    private readonly writes: GitHubWrites,
    private readonly now: () => Date,
  ) {}

  /**
   * Stores a batch the queue did not send. A batch queued while writes were
   * on already changed the app; that change is put back first, so the app
   * never says read while GitHub says unread.
   */
  park(batch: ParkedBatch): void {
    const createdAt = this.now().toISOString();
    this.store.transaction(() => {
      this.store.events.clearSeen(batch.local.eventIds);
      for (const key of batch.local.handledKeys) {
        this.store.userPrStates.clearHandled(key);
      }
      this.store.pendingWrites.add({
        createdAt,
        origin: batch.origin,
        tileId: batch.tileId,
        batch: batch.batchId,
        prKeys: batch.prKeys,
        handleKeys: batch.handleKeys,
        threads: batch.threads,
      });
    });
    for (const thread of batch.threads) {
      this.writes.log.record({
        action: 'mark_read',
        origin: batch.origin,
        outcome: 'pending',
        threadId: thread.id,
        prKey: thread.prKey,
        tileId: batch.tileId,
        batch: batch.batchId,
        detail: PENDING_DETAIL,
      });
    }
  }

  list(): PendingWrite[] {
    return this.store.pendingWrites.list();
  }

  private title(write: PendingWrite): string {
    const firstKey = write.prKeys[0] ?? write.threads[0]?.prKey ?? null;
    const pr = firstKey === null ? null : this.store.prs.get(firstKey);
    const more = write.prKeys.length > 1 ? ` (+${write.prKeys.length - 1})` : '';
    if (pr) {
      return `${pr.title}${more}`;
    }
    const thread = write.threads[0] ? this.store.notifications.get(write.threads[0].id) : null;
    return thread?.title ?? firstKey ?? 'notification';
  }

  views(): PendingWriteView[] {
    return this.list().map((write) => ({
      id: write.id,
      createdAt: write.createdAt,
      origin: write.origin,
      title: this.title(write),
      prKeys: write.prKeys,
      tileId: write.tileId,
      threadCount: write.threads.length,
      error: write.error,
    }));
  }

  /** The newest pending write per PR it covers, for the tile marker. */
  byPrKey(): Map<PrKey, TilePendingWrite> {
    const marks = new Map<PrKey, TilePendingWrite>();
    for (const write of this.list()) {
      for (const key of write.prKeys) {
        marks.set(key, { since: write.createdAt, error: write.error });
      }
    }
    return marks;
  }

  /** What the user saw at the click turns seen; later events stay unseen. */
  private markReadHere(keys: PrKey[], handleKeys: PrKey[], seenUpTo: string): void {
    if (keys.length === 0) {
      return;
    }
    const at = this.now().toISOString();
    this.store.transaction(() => {
      const eventIds: string[] = [];
      for (const events of this.store.events.listForPrs(keys).values()) {
        eventIds.push(...events.filter((event) => event.seenAt === null && event.at <= seenUpTo).map((event) => event.id));
      }
      this.store.events.markSeen(eventIds, at);
      for (const key of handleKeys.filter((candidate) => keys.includes(candidate))) {
        this.store.userPrStates.markHandled(key, at);
      }
    });
  }

  /**
   * Sends one pending write. Returns true when it is done: every thread
   * reached GitHub, was already read, or was left unread on purpose (activity
   * after the last sync). Threads that failed stay, with the error.
   */
  private async sendOne(write: PendingWrite, queue: MarkReadQueue): Promise<boolean> {
    const outcomes = await queue.markThreads(write.threads, { origin: 'footer', tileId: write.tileId, batchId: write.batch });
    const left: PendingThread[] = [];
    const errors: string[] = [];
    write.threads.forEach((thread, index) => {
      const outcome: ThreadOutcome | undefined = outcomes[index];
      if (outcome?.kind === 'failed') {
        left.push(thread);
        errors.push(outcome.error);
      } else if (outcome && outcome.kind !== 'skipped' && thread.prKey !== null) {
        this.markReadHere([thread.prKey], write.handleKeys, write.createdAt);
      }
    });
    if (left.length > 0) {
      this.store.pendingWrites.keepAfterTry(write.id, left, errors[0] ?? 'failed', this.now().toISOString());
      return false;
    }
    // PRs without an unread thread had nothing to send; they follow the rest.
    const threadKeys = new Set(write.threads.map((thread) => thread.prKey));
    const quiet = write.prKeys.filter((key) => !threadKeys.has(key));
    this.markReadHere(quiet, write.handleKeys, write.createdAt);
    for (const key of quiet) {
      this.writes.log.record({
        action: 'mark_read',
        origin: 'footer',
        outcome: 'local',
        prKey: key,
        tileId: write.tileId,
        batch: write.batch,
        detail: 'no unread GitHub thread',
      });
    }
    this.store.pendingWrites.remove(write.id);
    return true;
  }

  /** "Send N to GitHub". Refused while writes are off (the lock, or POSTPILE_READ_ONLY=1). */
  async send(queue: MarkReadQueue, status: () => GitHubWritesStatus): Promise<PendingWritesResult> {
    const writes = this.list();
    if (!this.writes.enabled()) {
      const reason = this.writes.status().forcedOffReason ?? 'Unlock GitHub writes first.';
      return { ok: false, message: `Not sent: GitHub writes are off. ${reason}`, done: 0, failed: writes.length, status: status() };
    }
    let done = 0;
    for (const write of writes) {
      if (await this.sendOne(write, queue)) {
        done += 1;
      }
    }
    const failed = writes.length - done;
    const message =
      failed === 0 ? `Sent ${done} to GitHub` : `Sent ${done} to GitHub, ${failed} failed and ${failed === 1 ? 'stays' : 'stay'} pending`;
    return { ok: failed === 0, message, done, failed, status: status() };
  }

  /** "Discard": drops every pending write. Nothing changes in the app; the tiles stay unread, like on GitHub. */
  discard(status: () => GitHubWritesStatus): PendingWritesResult {
    const writes = this.list();
    for (const write of writes) {
      this.store.pendingWrites.remove(write.id);
      for (const thread of write.threads) {
        this.writes.log.record({
          action: 'mark_read',
          origin: 'footer',
          outcome: 'discarded',
          threadId: thread.id,
          prKey: thread.prKey,
          tileId: write.tileId,
          batch: write.batch,
          detail: DISCARDED_DETAIL,
        });
      }
    }
    const message = writes.length === 0 ? 'Nothing pending' : `Discarded ${writes.length}: still unread, like on GitHub`;
    return { ok: true, message, done: writes.length, failed: 0, status: status() };
  }
}
