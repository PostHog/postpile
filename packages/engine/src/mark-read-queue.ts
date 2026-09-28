import { randomUUID } from 'node:crypto';
import {
  DeferredQueue,
  UNDO_WINDOW_MS,
  type ActionOrigin,
  type DeferredBatch,
  type IsoTime,
  type PrKey,
  type Timers,
} from '@code-manager/core';
import type { GitHubReader } from '@code-manager/github';
import { errorText } from './errors.ts';
import type { GitHubWrites } from './writes/github-writes.ts';

export { UNDO_WINDOW_MS, type Timers };

/** A thread to mark read, with its updated_at as of the last sync. */
export interface QueuedThread {
  id: string;
  updatedAt: IsoTime;
  /** Null for issues, releases and other non-PR threads. */
  prKey: PrKey | null;
}

/** Who queued a batch, for the action log. */
export interface BatchOrigin {
  origin: ActionOrigin;
  tileId: string | null;
}

interface MarkReadPayload extends BatchOrigin {
  threads: QueuedThread[];
  prKeys: PrKey[];
  /**
   * Whether GitHub writes were on when the batch was queued. A batch queued
   * while read-only stays local, even when writes are turned on inside its
   * undo window.
   */
  writesOn: boolean;
  /** Unique across restarts (the undo token is not), links log rows of one batch. */
  batchId: string;
}

export interface PendingBatch extends BatchOrigin {
  token: string;
  batchId: string;
  threadIds: string[];
  prKeys: PrKey[];
  writesOn: boolean;
  dueAt: number;
}

/**
 * Called after a thread was really marked read on GitHub, to mirror it
 * locally. readAt is the thread activity the user has seen, not the send time.
 */
export type ThreadMarkedRead = (threadId: string, readAt: IsoTime) => void;

function toPending(batch: DeferredBatch<MarkReadPayload>): PendingBatch {
  const { threads, prKeys, writesOn, batchId, origin, tileId } = batch.payload;
  return {
    token: batch.token,
    batchId,
    threadIds: threads.map((thread) => thread.id),
    prKeys,
    writesOn,
    origin,
    tileId,
    dueAt: batch.dueAt,
  };
}

/**
 * Deferred mark-read with undo. GitHub has no mark-unread API, so the call
 * waits UNDO_WINDOW_MS before it is sent. Batches stack, undo walks back
 * newest first, flush sends everything right away (on quit). In memory only.
 *
 * A mark-read covers the whole thread on GitHub, including activity that came
 * after the last on-demand sync. So each thread is read again first; if it
 * moved since the sync, it stays unread and the next sync picks the new
 * activity up instead of it being lost.
 *
 * Every send goes through GitHubWrites, so it respects the footer lock and
 * lands in the action log (origin `queue`, or `quit` for the flush).
 */
export class MarkReadQueue {
  private readonly queue: DeferredQueue<MarkReadPayload>;
  /** Things the user should hear about, drained into the next sync report. */
  private notes: string[] = [];
  private flushing = false;

  constructor(
    private readonly writes: GitHubWrites,
    private readonly reader: GitHubReader,
    timers: Timers,
    delayMs: number = UNDO_WINDOW_MS,
    private readonly onMarked: ThreadMarkedRead = () => {},
  ) {
    this.queue = new DeferredQueue<MarkReadPayload>(
      (payload) => this.send(payload),
      timers,
      delayMs,
      (error) => console.error('mark-read failed:', error),
    );
  }

  private async markOne(thread: QueuedThread, payload: MarkReadPayload): Promise<void> {
    const context = {
      origin: this.flushing ? ('quit' as const) : ('queue' as const),
      prKey: thread.prKey,
      tileId: payload.tileId,
      batch: payload.batchId,
    };
    const log = (outcome: 'observed' | 'skipped' | 'local', detail: string) =>
      this.writes.log.record({ action: 'mark_read', threadId: thread.id, ...context, outcome, detail });
    if (!this.writes.enabled()) {
      log('local', 'GitHub writes were turned off before it was sent');
      return;
    }
    const current = await this.reader.getThread(thread.id);
    if (current === null || !current.unread) {
      // Gone, or read somewhere else in the meantime: nothing to send.
      this.onMarked(thread.id, current?.lastReadAt ?? thread.updatedAt);
      log('observed', 'already read on GitHub');
      return;
    }
    if (current.updatedAt > thread.updatedAt) {
      this.notes.push(`mark-read: left notification ${thread.id} unread, it has activity after the last sync`);
      log('skipped', 'left unread: activity after the last sync');
      return;
    }
    const result = await this.writes.markThreadRead(thread.id, context);
    if (result === 'sent') {
      this.onMarked(thread.id, current.updatedAt);
    }
  }

  /**
   * One failed thread must not stop the rest of the batch. Nothing retries a
   * failure: the batch already left the undo queue. The thread stays unread
   * locally and on GitHub, and the next sync report says so. A batch queued
   * while read-only sends nothing; its local rows were logged when it was queued.
   */
  private async send(payload: MarkReadPayload): Promise<void> {
    if (!payload.writesOn) {
      return;
    }
    for (const thread of payload.threads) {
      try {
        await this.markOne(thread, payload);
      } catch (error) {
        this.notes.push(`mark-read: notification ${thread.id} failed: ${errorText(error)}`);
      }
    }
  }

  enqueue(threads: QueuedThread[], prKeys: PrKey[], origin: BatchOrigin): PendingBatch {
    const payload: MarkReadPayload = { threads, prKeys, ...origin, writesOn: this.writes.enabled(), batchId: randomUUID() };
    return toPending(this.queue.enqueue(payload));
  }

  /** Returns the undone batch, or null when nothing is pending (already sent). */
  undo(token: string | null): PendingBatch | null {
    const batch = this.queue.undo(token);
    return batch ? toPending(batch) : null;
  }

  pending(): PendingBatch[] {
    return this.queue.pending().map(toPending);
  }

  /** Returns and forgets what happened to sent batches that the user should know about. */
  takeNotes(): string[] {
    const notes = this.notes;
    this.notes = [];
    return notes;
  }

  async flush(): Promise<void> {
    this.flushing = true;
    try {
      await this.queue.flush();
    } finally {
      this.flushing = false;
    }
  }
}
