import { randomUUID } from 'node:crypto';
import {
  DeferredQueue,
  UNDO_WINDOW_MS,
  type ActionOrigin,
  type DeferredBatch,
  type IsoTime,
  type PendingThread,
  type PrKey,
  type SubscriptionChange,
  type ThreadOutcome,
  type Timers,
} from '@postpile/core';
import type { GitHubReader } from '@postpile/github';
import type { LocalChange } from './actions/local-change.ts';
import { NO_LOCAL_CHANGE } from './actions/local-change.ts';
import { errorText } from './errors.ts';
import type { ClickedReadRetry } from './writes/clicked-read-retry.ts';
import { notTakenDetail, type GitHubWrites } from './writes/github-writes.ts';
import { markThreadReadIfUnchanged } from './writes/thread-mark-read.ts';

export type { ThreadOutcome };

/** Who queued a batch, for the action log. */
export interface BatchOrigin {
  origin: ActionOrigin;
  tileId: string | null;
}

export { NO_LOCAL_CHANGE, type LocalChange } from './actions/local-change.ts';

/** One click's worth of mark-read. */
export interface MarkReadRequest {
  threads: PendingThread[];
  prKeys: PrKey[];
  /** PRs that also count as handled once read (pinged members). */
  handleKeys: PrKey[];
  local: LocalChange;
  /** Mute's unsubscribe or Unmute's subscribe, sent after the mark-read on the same terms; null for a plain mark-read. */
  subscription: SubscriptionChange | null;
  /** When the user clicked, before the undo window. A parked subscription change keeps it (`PendingWrites.park`). */
  clickedAt: IsoTime;
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
  subscription: SubscriptionChange | null;
  dueAt: number;
}

/**
 * A batch whose undo window ran out while GitHub writes were locked (or that
 * was queued locked). It becomes a pending write instead of being sent.
 */
export type ParkedBatch = BatchOrigin &
  MarkReadRequest & {
    batchId: string;
    /** Why GitHub did not take the subscription change when it was sent; the pending row keeps it. Absent or null: the lock stopped it. */
    subscriptionError?: string | null;
  };

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

/** Why a Mute's unsubscribe was not sent: the mute ended before it went out. */
export const MUTE_ENDED_REASON = 'the mute ended before it was sent (someone asked you in person, or the PR closed); stays subscribed';

/** Why an Unmute's subscribe was not sent: the PR was muted again before it went out. */
export const MUTED_AGAIN_REASON = 'the PR was muted again before it was sent; stays unsubscribed';

/** Whether a PR's mute still holds, as the store has it now (`muteHolds`). */
export type MuteCheck = (prKey: PrKey) => boolean;

/**
 * Who sends, for the log: the queue when a window ran out, the quit flush,
 * the user sending pending writes from the footer, or PostPile sending them
 * once when writes went on by default.
 */
export interface SendContext {
  origin: 'queue' | 'quit' | 'footer' | 'default';
  tileId: string | null;
  batchId: string;
}

function toPending(batch: DeferredBatch<MarkReadPayload>): PendingBatch {
  const { threads, prKeys, writesOn, batchId, origin, tileId, local, subscription } = batch.payload;
  return {
    token: batch.token,
    batchId,
    threadIds: threads.map((thread) => thread.id),
    prKeys,
    writesOn,
    local,
    subscription,
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
 * moved since the sync, the PR is fetched again and the click decided again
 * (`ClickedReadRetry`): only the user's own activity and automation since,
 * and it is marked read after all; a person's activity, and it stays unread
 * with a notice, so nothing new is lost.
 *
 * A batch is only sent when it was queued with writes on and they are still
 * on when its window ends. Otherwise it is parked (`onParked`) as a pending
 * write, and nothing reaches GitHub until the user sends it from the footer.
 *
 * Every send goes through GitHubWrites, so it respects the footer lock and
 * lands in the action log (origin `queue`, `quit` for the flush, `footer`
 * for pending writes).
 *
 * Mute and Unmute ride along (2026-10-05): a batch's `subscription` change
 * goes to GitHub after its mark-read, on the same terms: undone inside the
 * window, parked as a pending write while locked.
 */
export class MarkReadQueue {
  private readonly queue: DeferredQueue<MarkReadPayload>;
  /** Things the user should hear about, drained into the next sync report. */
  private notes: string[] = [];
  private flushing = false;
  /** Decides a thread skipped for newer activity again; set by the engine, which owns the refresh. */
  private retry: ClickedReadRetry | null = null;
  /** How often a thread GitHub has read was mirrored locally (`onMarked`), so the renderer refetches. */
  private mirrors = 0;
  /** Asked before each unsubscribe; set by the engine, which owns the store. Without it every unsubscribe goes out. */
  private muteCheck: MuteCheck | null = null;

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

  /** Mirrors a thread GitHub has read locally and counts it. */
  private markedLocally(threadId: string, readAt: IsoTime): void {
    this.onMarked(threadId, readAt);
    this.mirrors += 1;
  }

  /** Every batch comes from a user's click, so a skip for newer activity gets a refresh and a second decision. */
  retryWith(retry: ClickedReadRetry): void {
    this.retry = retry;
  }

  /** A subscription change goes out only while it still matches the PR's mute (see `changeSubscriptions`). */
  checkMutesWith(check: MuteCheck): void {
    this.muteCheck = check;
  }

  /**
   * Why a subscription change no longer fits the PR's mute, or null when it
   * does (or there is nothing to check):
   * - an unsubscribe whose mute ended meanwhile: a mention, reply or review
   *   request during the undo window (the retry's refresh stored it) or
   *   before a pending one was sent. The tile is back as an ordinary tile
   *   without Unmute, so GitHub must keep the viewer subscribed;
   * - a subscribe (an Unmute, often a failed one waiting to be sent again)
   *   while the PR is muted again: the newer mute's unsubscribe wins.
   */
  private staleReason(change: SubscriptionChange, thread: PendingThread): string | null {
    if (thread.prKey === null || this.muteCheck === null) {
      return null;
    }
    const muted = this.muteCheck(thread.prKey);
    if (change.subscribed) {
      return muted ? MUTED_AGAIN_REASON : null;
    }
    return muted ? null : MUTE_ENDED_REASON;
  }

  private async markOne(thread: PendingThread, context: SendContext): Promise<ThreadOutcome> {
    const logContext = { origin: context.origin, prKey: thread.prKey, tileId: context.tileId, batch: context.batchId };
    const log = (outcome: 'observed' | 'skipped', detail: string) =>
      this.writes.log.record({ action: 'mark_read', threadId: thread.id, ...logContext, outcome, detail });
    const result = await markThreadReadIfUnchanged(this.reader, this.writes, thread, logContext);
    if (result.kind === 'already_read') {
      this.markedLocally(thread.id, result.lastReadAt ?? thread.updatedAt);
      log('observed', 'already read on GitHub');
      return { kind: 'observed' };
    }
    // Decided before `send` puts anything back, so the tile does not flicker unread and read again. Not on quit: nothing waits for a refresh then.
    // Not for the send when writes went on by default either: nobody clicked now, so newer activity leaves the thread unread.
    // (That send runs inside the sync, and the retry's refresh waits for the running sync: it would never end.)
    if (result.kind === 'moved' && this.retry && !this.flushing && context.origin !== 'default' && thread.prKey !== null) {
      return this.retry.afterNewerActivity(thread, thread.prKey, logContext);
    }
    if (result.kind === 'moved') {
      log('skipped', notTakenDetail(NEWER_ACTIVITY_REASON));
      return { kind: 'skipped', reason: NEWER_ACTIVITY_REASON };
    }
    if (result.kind === 'off') {
      return { kind: 'off' };
    }
    this.markedLocally(thread.id, result.readAt);
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
   * Changes the viewer's subscription to each thread on GitHub, in order:
   * Mute's unsubscribe or Unmute's subscribe. One failed thread does not
   * stop the rest; its outcome carries the error (already logged). A
   * change that no longer fits the PR's mute is skipped (`staleReason`).
   */
  async changeSubscriptions(change: SubscriptionChange, context: SendContext): Promise<ThreadOutcome[]> {
    const outcomes: ThreadOutcome[] = [];
    for (const thread of change.threads) {
      const writeContext = { origin: context.origin, prKey: thread.prKey, tileId: context.tileId, batch: context.batchId };
      const stale = this.staleReason(change, thread);
      if (stale !== null) {
        const action = change.subscribed ? 'subscribe' : 'unsubscribe';
        this.writes.log.record({ action, threadId: thread.id, ...writeContext, outcome: 'skipped', detail: stale });
        outcomes.push({ kind: 'skipped', reason: stale });
        continue;
      }
      try {
        const result = change.subscribed ? await this.writes.subscribeThread(thread.id, writeContext) : await this.writes.unsubscribeThread(thread.id, writeContext);
        outcomes.push(result === 'off' ? { kind: 'off' } : { kind: 'sent' });
      } catch (error) {
        outcomes.push({ kind: 'failed', error: errorText(error) });
      }
    }
    return outcomes;
  }

  /**
   * The batch's subscription change, after its mark-read. Unlike a
   * mark-read, nothing in the app goes back when GitHub does not take it
   * (the mute or unmute stays), so a thread that failed is not dropped: it
   * is returned with the threads the lock stopped mid-send, to wait as a
   * pending write with the error and be sent again from the lock.
   */
  private async sendSubscription(payload: MarkReadPayload, context: SendContext): Promise<{ left: PendingThread[]; error: string | null }> {
    if (payload.subscription === null) {
      return { left: [], error: null };
    }
    const outcomes = await this.changeSubscriptions(payload.subscription, context);
    const verb = payload.subscription.subscribed ? 'subscribe' : 'unsubscribe';
    const left: PendingThread[] = [];
    let error: string | null = null;
    outcomes.forEach((outcome, index) => {
      const thread = payload.subscription?.threads[index];
      if (!thread) {
        return;
      }
      if (outcome.kind === 'off') {
        left.push(thread);
      } else if (outcome.kind === 'failed') {
        left.push(thread);
        error ??= outcome.error;
        this.notes.push(`${verb} of ${thread.prKey ?? `notification ${thread.id}`}: GitHub didn't take it: ${outcome.error}; pending, send it again from the lock`);
      }
    });
    return { left, error };
  }

  /**
   * Threads the lock stopped mid-send become a pending write, like a batch
   * that found writes off before it started. Their PRs go back to unread
   * first: GitHub does not have them read yet. A subscription change the
   * lock stopped, or GitHub did not take, waits the same way (`sendSubscription`).
   */
  private parkOff(payload: MarkReadPayload, off: PendingThread[], subscriptionLeft: { left: PendingThread[]; error: string | null }): void {
    if (off.length === 0 && subscriptionLeft.left.length === 0) {
      return;
    }
    for (const thread of off) {
      this.onNotTaken(thread, payload.local);
    }
    const offKeys = new Set(off.flatMap((thread) => (thread.prKey === null ? [] : [thread.prKey])));
    const subscribed = payload.subscription?.subscribed ?? false;
    this.onParked({
      origin: payload.origin,
      tileId: payload.tileId,
      batchId: payload.batchId,
      threads: off,
      prKeys: [...offKeys],
      handleKeys: payload.handleKeys.filter((key) => offKeys.has(key)),
      local: NO_LOCAL_CHANGE,
      subscription: subscriptionLeft.left.length > 0 ? { subscribed, threads: subscriptionLeft.left } : null,
      subscriptionError: subscriptionLeft.error,
      clickedAt: payload.clickedAt,
    });
  }

  /**
   * Parks the batch when writes were or are off. Nothing retries a failure of
   * a batch sent from the queue: it already left the undo queue. A thread
   * GitHub did not take (failed, or skipped for newer activity) puts its PR
   * back to unread here, and the next sync report says why. Threads the lock
   * stopped mid-send are parked (parkOff). A Mute's or Unmute's
   * subscription change goes after the mark-read, whatever became of it;
   * what GitHub did not take of it is parked too, with the error.
   */
  private async send(payload: MarkReadPayload): Promise<void> {
    if (payload.threads.length === 0 && (payload.subscription?.threads.length ?? 0) === 0) {
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
    const subscriptionLeft = await this.sendSubscription(payload, context);
    this.parkOff(payload, off, subscriptionLeft);
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

  /**
   * Threads of batches not finished yet: waiting out the undo window, or
   * being sent. They are read locally already, so a sync must not put them
   * back to unread from an inbox that still lists them.
   */
  threadIds(): Set<string> {
    return new Set(this.queue.unfinished().flatMap((payload) => payload.threads.map((thread) => thread.id)));
  }

  /** Counts every local mirror of a thread GitHub has read; part of the poll's change count. */
  mirrored(): number {
    return this.mirrors;
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
