import { DeferredQueue, UNDO_WINDOW_MS, type DeferredBatch, type PrKey, type Timers } from '@code-manager/core';
import type { GitHubWriter } from '@code-manager/github';

export { UNDO_WINDOW_MS, type Timers };

export interface MarkReadPayload {
  threadIds: string[];
  prKeys: PrKey[];
}

export interface PendingBatch {
  token: string;
  threadIds: string[];
  prKeys: PrKey[];
  dueAt: number;
}

/** Called after a thread was really marked read on GitHub, to mirror it locally. */
export type ThreadMarkedRead = (threadId: string) => void;

function toPending(batch: DeferredBatch<MarkReadPayload>): PendingBatch {
  return { token: batch.token, threadIds: batch.payload.threadIds, prKeys: batch.payload.prKeys, dueAt: batch.dueAt };
}

/**
 * Deferred mark-read with undo. GitHub has no mark-unread API, so the call
 * waits UNDO_WINDOW_MS before it is sent. Batches stack, undo walks back
 * newest first, flush sends everything right away (on quit). In memory only.
 */
export class MarkReadQueue {
  private readonly queue: DeferredQueue<MarkReadPayload>;

  constructor(
    private readonly writer: GitHubWriter,
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

  private async send(payload: MarkReadPayload): Promise<void> {
    for (const threadId of payload.threadIds) {
      await this.writer.markThreadRead(threadId);
      this.onMarked(threadId);
    }
  }

  enqueue(threadIds: string[], prKeys: PrKey[]): PendingBatch {
    return toPending(this.queue.enqueue({ threadIds, prKeys }));
  }

  /** Returns the undone batch, or null when nothing is pending (already sent). */
  undo(token: string | null): PendingBatch | null {
    const batch = this.queue.undo(token);
    return batch ? toPending(batch) : null;
  }

  pending(): PendingBatch[] {
    return this.queue.pending().map(toPending);
  }

  flush(): Promise<void> {
    return this.queue.flush();
  }
}
