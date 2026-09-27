import {
  DeferredQueue,
  UNDO_WINDOW_MS,
  type DeferredBatch,
  type IsoTime,
  type PrKey,
  type Timers,
} from '@code-manager/core';
import type { GitHubReader, GitHubWriter } from '@code-manager/github';

export { UNDO_WINDOW_MS, type Timers };

/** A thread to mark read, with its updated_at as of the last sync. */
export interface QueuedThread {
  id: string;
  updatedAt: IsoTime;
}

export interface MarkReadPayload {
  threads: QueuedThread[];
  prKeys: PrKey[];
}

export interface PendingBatch {
  token: string;
  threadIds: string[];
  prKeys: PrKey[];
  dueAt: number;
}

/**
 * Called after a thread was really marked read on GitHub, to mirror it
 * locally. readAt is the thread activity the user has seen, not the send time.
 */
export type ThreadMarkedRead = (threadId: string, readAt: IsoTime) => void;

function toPending(batch: DeferredBatch<MarkReadPayload>): PendingBatch {
  return {
    token: batch.token,
    threadIds: batch.payload.threads.map((thread) => thread.id),
    prKeys: batch.payload.prKeys,
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
 */
export class MarkReadQueue {
  private readonly queue: DeferredQueue<MarkReadPayload>;
  /** Things the user should hear about, drained into the next sync report. */
  private notes: string[] = [];

  constructor(
    private readonly writer: GitHubWriter,
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

  private async markOne(thread: QueuedThread): Promise<void> {
    const current = await this.reader.getThread(thread.id);
    if (current === null || !current.unread) {
      // Gone, or read somewhere else in the meantime: nothing to send.
      this.onMarked(thread.id, current?.lastReadAt ?? thread.updatedAt);
      return;
    }
    if (current.updatedAt > thread.updatedAt) {
      this.notes.push(`mark-read: left notification ${thread.id} unread, it has activity after the last sync`);
      return;
    }
    await this.writer.markThreadRead(thread.id);
    this.onMarked(thread.id, current.updatedAt);
  }

  /**
   * One failed thread must not stop the rest of the batch. Nothing retries a
   * failure: the batch already left the undo queue. The thread stays unread
   * locally and on GitHub, and the next sync report says so.
   */
  private async send(payload: MarkReadPayload): Promise<void> {
    for (const thread of payload.threads) {
      try {
        await this.markOne(thread);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.notes.push(`mark-read: notification ${thread.id} failed: ${message}`);
      }
    }
  }

  enqueue(threads: QueuedThread[], prKeys: PrKey[]): PendingBatch {
    return toPending(this.queue.enqueue({ threads, prKeys }));
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

  flush(): Promise<void> {
    return this.queue.flush();
  }
}
