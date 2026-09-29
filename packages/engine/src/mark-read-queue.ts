import { randomUUID } from 'node:crypto';
import {
  DeferredQueue,
  NO_READ_CHANGE,
  UNDO_WINDOW_MS,
  type ActionOrigin,
  type DeferredBatch,
  type IsoTime,
  type PendingThread,
  type PrKey,
  type ReadChange,
  type ThreadOutcome,
  type Timers,
} from '@postpile/core';
import type { GitHubReader } from '@postpile/github';
import { errorText } from './errors.ts';
import { notTakenDetail, type GitHubWrites } from './writes/github-writes.ts';
import { markThreadReadIfUnchanged } from './writes/thread-mark-read.ts';

export type { ThreadOutcome };

/** Who queued a batch, for the action log. */
export interface BatchOrigin {
  origin: ActionOrigin;
  tileId: string | null;
}

/** What a mark-read changed in the app right away, so an undo (or parking the batch) can put it back (`planRead`'s change). */
export type LocalChange = ReadChange;

export const NO_LOCAL_CHANGE: LocalChange = NO_READ_CHANGE;

/** One click's worth of mark-read. */
export interface MarkReadRequest {
  threads: PendingThread[];
  prKeys: PrKey[];
  /** PRs that also count as handled once read (pinged members). */
  handleKeys: PrKey[];
  local: LocalChange;
}

interface MarkReadPayload extends BatchOrigin, MarkReadRequest {
  /** Whether GitHub writes were on when the batch was queued. */
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
  local: LocalChange;
  dueAt: number;
}

/**
 * A batch whose undo window ran out while GitHub writes were locked (or that
 * was queued locked). It becomes a pending write instead of being sent.
 */
export type ParkedBatch = BatchOrigin & MarkReadRequest & { batchId: string };

/**
 * Called after a thread was really marked read on GitHub, to mirror it
 * locally. readAt is the thread activity the user has seen, not the send time.
 */
export type ThreadMarkedRead = (threadId: string, readAt: IsoTime) => void;

/**
 * Called when GitHub did not take a thread of a batch sent with writes on
 * (failed, or skipped for newer activity). The app already changed at the
 * click, so this puts that PR back to unread: the app never holds a read
 * state GitHub doesn't have.
 */
export type ThreadNotTaken = (thread: PendingThread, local: LocalChange) => void;

export const NEWER_ACTIVITY_REASON = 'activity after the last sync';

/** Who sends, for the log: the queue when a window ran out, the quit flush, or the user sending pending writes from the footer. */
export interface SendContext {
  origin: 'queue' | 'quit' | 'footer';
  tileId: string | null;
  batchId: string;
}

function toPending(batch: DeferredBatch<MarkReadPayload>): PendingBatch {
  const { threads, prKeys, writesOn, batchId, origin, tileId, local } = batch.payload;
  return {
    token: batch.token,
    batchId,
    threadIds: threads.map((thread) => thread.id),
    prKeys,
    writesOn,
    local,
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
 * A batch is only sent when it was queued with writes on and they are still
 * on when its window ends. Otherwise it is parked (`onParked`) as a pending
 * write, and nothing reaches GitHub until the user sends it from the footer.
 *
 * Every send goes through GitHubWrites, so it respects the footer lock and
 * lands in the action log (origin `queue`, `quit` for the flush, `footer`
 * for pending writes).
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
    private readonly onParked: (batch: ParkedBatch) => void = () => {},
    private readonly onNotTaken: ThreadNotTaken = () => {},
  ) {
    this.queue = new DeferredQueue<MarkReadPayload>(
      (payload) => this.send(payload),
      timers,
      delayMs,
      (error) => console.error('mark-read failed:', error),
    );
  }

  writesEnabled(): boolean {
    return this.writes.enabled();
  }

  private async markOne(thread: PendingThread, context: SendContext): Promise<ThreadOutcome> {
    const logContext = { origin: context.origin, prKey: thread.prKey, tileId: context.tileId, batch: context.batchId };
    const log = (outcome: 'observed' | 'skipped', detail: string) =>
      this.writes.log.record({ action: 'mark_read', threadId: thread.id, ...logContext, outcome, detail });
    const result = await markThreadReadIfUnchanged(this.reader, this.writes, thread, logContext);
    if (result.kind === 'already_read') {
      this.onMarked(thread.id, result.lastReadAt ?? thread.updatedAt);
      log('observed', 'already read on GitHub');
      return { kind: 'observed' };
    }
    if (result.kind === 'moved') {
      log('skipped', notTakenDetail(NEWER_ACTIVITY_REASON));
      return { kind: 'skipped', reason: NEWER_ACTIVITY_REASON };
    }
    if (result.kind === 'off') {
      return { kind: 'off' };
    }
    this.onMarked(thread.id, result.readAt);
    return { kind: 'sent' };
  }

  /**
   * Marks each thread read on GitHub, in order. One failed thread does not
   * stop the rest; its outcome carries the error (already logged).
   */
  async markThreads(threads: PendingThread[], context: SendContext): Promise<ThreadOutcome[]> {
    const outcomes: ThreadOutcome[] = [];
    for (const thread of threads) {
      try {
        outcomes.push(await this.markOne(thread, context));
      } catch (error) {
        outcomes.push({ kind: 'failed', error: errorText(error) });
      }
    }
    return outcomes;
  }

  /**
   * Threads the lock stopped mid-send become a pending write, like a batch
   * that found writes off before it started. Their PRs go back to unread
   * first: GitHub does not have them read yet.
   */
  private parkOff(payload: MarkReadPayload, off: PendingThread[]): void {
    if (off.length === 0) {
      return;
    }
    for (const thread of off) {
      this.onNotTaken(thread, payload.local);
    }
    const offKeys = new Set(off.flatMap((thread) => (thread.prKey === null ? [] : [thread.prKey])));
    this.onParked({
      origin: payload.origin,
      tileId: payload.tileId,
      batchId: payload.batchId,
      threads: off,
      prKeys: [...offKeys],
      handleKeys: payload.handleKeys.filter((key) => offKeys.has(key)),
      local: NO_LOCAL_CHANGE,
    });
  }

  /**
   * Parks the batch when writes were or are off. Nothing retries a failure of
   * a batch sent from the queue: it already left the undo queue. A thread
   * GitHub did not take (failed, or skipped for newer activity) puts its PR
   * back to unread here, and the next sync report says why. Threads the lock
   * stopped mid-send are parked (parkOff).
   */
  private async send(payload: MarkReadPayload): Promise<void> {
    if (payload.threads.length === 0) {
      return;
    }
    if (!payload.writesOn || !this.writes.enabled()) {
      const { writesOn: _writesOn, ...parked } = payload;
      this.onParked(parked);
      return;
    }
    const context: SendContext = { origin: this.flushing ? 'quit' : 'queue', tileId: payload.tileId, batchId: payload.batchId };
    const outcomes = await this.markThreads(payload.threads, context);
    const off: PendingThread[] = [];
    outcomes.forEach((outcome, index) => {
      const thread = payload.threads[index];
      if (!thread) {
        return;
      }
      if (outcome.kind === 'off') {
        off.push(thread);
        return;
      }
      if (outcome.kind !== 'failed' && outcome.kind !== 'skipped') {
        return;
      }
      const reason = outcome.kind === 'failed' ? outcome.error : outcome.reason;
      this.onNotTaken(thread, payload.local);
      this.notes.push(`mark-read of ${thread.prKey ?? `notification ${thread.id}`}: ${notTakenDetail(reason)}`);
    });
    this.parkOff(payload, off);
  }

  enqueue(request: MarkReadRequest, origin: BatchOrigin): PendingBatch {
    const payload: MarkReadPayload = { ...request, ...origin, writesOn: this.writes.enabled(), batchId: randomUUID() };
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

  /** On quit. A batch that would be parked is parked (stored), so a locked mark-read survives the restart. */
  async flush(): Promise<void> {
    this.flushing = true;
    try {
      await this.queue.flush();
    } finally {
      this.flushing = false;
    }
  }
}
