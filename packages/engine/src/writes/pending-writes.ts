import {
  pendingWriteStep,
  PENDING_WRITES_OFF,
  unreadOlderThan,
  type GitHubWritesStatus,
  type IsoTime,
  type PendingWrite,
  type PendingWriteCause,
  type PendingWriteView,
  type PendingWritesResult,
  type PrKey,
  type TilePendingWrite,
} from '@postpile/core';
import type { Store } from '@postpile/store';
import { putBackLocalChange, readLocally } from '../actions/local-change.ts';
import { errorText } from '../errors.ts';
import type { MarkReadQueue, ParkedBatch } from '../mark-read-queue.ts';
import { notTakenDetail, type GitHubWrites } from './github-writes.ts';

export const PENDING_DETAIL = 'GitHub writes are locked: waits until you unlock and send it';
export const DISCARDED_DETAIL = 'discarded while locked: stays unread, like on GitHub';
export const CLEANUP_PENDING_DETAIL = 'GitHub writes are locked: the cleanup waits until you unlock and send it';
export const CLEANUP_DISCARDED_DETAIL = 'cleanup discarded while locked: GitHub keeps them unread';
export const OBSERVED_PENDING_DETAIL = 'left the inbox: read on github.com or another client; pending mark-read cleared';

/**
 * Mark-reads made while GitHub writes are locked. GitHub is the source of
 * truth for read and unread, so a locked mark-read changes nothing in the
 * app. When its undo window runs out it is stored here (pending_write) and
 * logged as `pending`; the tile keeps its state and shows a marker. The user
 * sends them when unlocking (the PRs turn read here as each thread reaches
 * GitHub; failures stay pending with the error), or discards them (nothing
 * changes, the tiles stay unread like GitHub has them).
 *
 * What happens to a stored write is decided by `pendingWriteStep` (core);
 * `apply` carries out its effects and stores the next state, so every
 * change to a pending write goes through one place.
 */
export class PendingWrites {
  /** The send in flight; a second "Send" while it runs joins it instead of sending the same rows twice. */
  private sending: Promise<PendingWritesResult> | null = null;

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
      putBackLocalChange(this.store, batch.local);
      this.store.pendingWrites.add({
        kind: 'mark_read',
        readBefore: null,
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

  /**
   * The inbox cleanup while locked: one pending "mark everything before
   * `readBefore` read on GitHub". Nothing changes in the app until it is sent.
   */
  parkCleanup(readBefore: IsoTime, batch: string): void {
    this.store.pendingWrites.add({
      kind: 'mark_all_read_before',
      readBefore,
      createdAt: this.now().toISOString(),
      origin: 'cleanup',
      tileId: null,
      batch,
      prKeys: [],
      handleKeys: [],
      threads: [],
    });
    this.writes.log.record({ action: 'mark_all_read_before', origin: 'cleanup', outcome: 'pending', batch, detail: `last_read_at=${readBefore}: ${CLEANUP_PENDING_DETAIL}` });
  }

  list(): PendingWrite[] {
    return this.store.pendingWrites.list();
  }

  /** The cutoff of a cleanup waiting for the lock, the newest if several. */
  pendingCleanupCutoff(): IsoTime | null {
    return this.list().filter((write) => write.kind === 'mark_all_read_before').at(-1)?.readBefore ?? null;
  }

  private title(write: PendingWrite): string {
    if (write.kind === 'mark_all_read_before') {
      return `Cleanup: mark everything before ${(write.readBefore ?? '').slice(0, 10)} read`;
    }
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
    const threads = this.store.notifications.list();
    return this.list().map((write) => ({
      id: write.id,
      kind: write.kind,
      createdAt: write.createdAt,
      origin: write.origin,
      title: this.title(write),
      prKeys: write.prKeys,
      tileId: write.tileId,
      threadCount: write.kind === 'mark_all_read_before' ? unreadOlderThan(threads, write.readBefore ?? '', null) : write.threads.length,
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

  private logDiscarded(write: PendingWrite): void {
    if (write.kind === 'mark_all_read_before') {
      this.writes.log.record({
        action: 'mark_all_read_before',
        origin: 'footer',
        outcome: 'discarded',
        batch: write.batch,
        detail: `last_read_at=${write.readBefore ?? ''}: ${CLEANUP_DISCARDED_DETAIL}`,
      });
    }
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

  /**
   * Runs one transition (`pendingWriteStep`): carries out its effects in
   * order and stores the next state. PRs that turn read here get what the
   * user saw at the click seen (later events stay unseen) and the write's
   * handle keys handled. Returns true when the write is gone; what the user
   * should hear goes to `notes`.
   */
  private apply(write: PendingWrite, cause: PendingWriteCause, origin: 'footer' | 'sync' | 'poll', notes: string[] = []): boolean {
    const step = pendingWriteStep(write, cause);
    const at = this.now().toISOString();
    for (const effect of step.effects) {
      switch (effect.kind) {
        case 'read_here':
          readLocally(this.store, { prKeys: effect.prKeys, handleKeys: write.handleKeys }, { kind: 'pending_completion', clickedAt: write.createdAt }, at);
          break;
        case 'log_local':
          this.writes.log.record({
            action: 'mark_read',
            origin,
            outcome: 'local',
            prKey: effect.prKey,
            tileId: write.tileId,
            batch: write.batch,
            detail: 'no unread GitHub thread',
          });
          break;
        case 'not_taken':
          notes.push(`${this.title(write)}: ${notTakenDetail(effect.reason)}`);
          break;
        case 'still_pending':
          notes.push(`${this.title(write)}: GitHub didn't take it: ${effect.error}; still pending`);
          break;
        case 'log_discarded':
          this.logDiscarded(write);
          break;
      }
    }
    switch (step.next.kind) {
      case 'gone':
        this.store.pendingWrites.remove(write.id);
        return true;
      case 'kept':
        this.store.pendingWrites.keepAfterTry(write.id, step.next.threads, step.next.error, at);
        return false;
      case 'narrowed':
        this.store.pendingWrites.replaceThreads(write.id, step.next.threads);
        return false;
      case 'unchanged':
        return false;
    }
  }

  /**
   * The cleanup's single PUT. Done when GitHub took it; a failure stays
   * pending with the error, and so does a cleanup the lock stopped mid-send
   * (the same as a thread write stopped there).
   */
  private async sendCleanup(write: PendingWrite, notTaken: string[]): Promise<boolean> {
    try {
      const result = await this.writes.markAllReadBefore(write.readBefore ?? '', { origin: 'footer', batch: write.batch });
      if (result === 'off') {
        return this.apply(write, { kind: 'cleanup_not_taken', error: PENDING_WRITES_OFF }, 'footer', notTaken);
      }
    } catch (error) {
      return this.apply(write, { kind: 'cleanup_not_taken', error: errorText(error) }, 'footer', notTaken);
    }
    return this.apply(write, { kind: 'cleanup_sent' }, 'footer', notTaken);
  }

  /**
   * Sends one pending write. Returns true when it is done: every thread
   * reached GitHub, was already read, or was left unread on purpose (activity
   * after the last sync, its reason goes to `notTaken`). Threads that failed
   * stay, with the error.
   */
  private async sendOne(write: PendingWrite, queue: MarkReadQueue, notTaken: string[]): Promise<boolean> {
    if (write.kind === 'mark_all_read_before') {
      return this.sendCleanup(write, notTaken);
    }
    const outcomes = await queue.markThreads(write.threads, { origin: 'footer', tileId: write.tileId, batchId: write.batch });
    return this.apply(write, { kind: 'sent', outcomes }, 'footer', notTaken);
  }

  /**
   * The sync or the live poll saw these threads leave the inbox: read on
   * github.com or another client. A pending write for them has nothing left
   * to send, so it is cleared and the PR turns read here, like a send that
   * found the thread already read. Returns the thread ids that had one, so
   * the caller's `observed` log row can say so.
   */
  observeRead(threadIds: ReadonlySet<string>, origin: 'sync' | 'poll'): Set<string> {
    const cleared = new Set<string>();
    for (const write of this.list()) {
      if (write.kind === 'mark_all_read_before') {
        continue;
      }
      for (const thread of write.threads.filter((candidate) => threadIds.has(candidate.id))) {
        cleared.add(thread.id);
      }
      this.apply(write, { kind: 'read_elsewhere', threadIds }, origin);
    }
    return cleared;
  }

  private async sendAll(queue: MarkReadQueue, status: () => GitHubWritesStatus): Promise<PendingWritesResult> {
    const writes = this.list();
    if (!this.writes.enabled()) {
      const reason = this.writes.status().forcedOffReason ?? 'Unlock GitHub writes first.';
      return { ok: false, message: `Not sent: GitHub writes are off. ${reason}`, done: 0, failed: writes.length, status: status() };
    }
    let done = 0;
    const notTaken: string[] = [];
    for (const write of writes) {
      if (await this.sendOne(write, queue, notTaken)) {
        done += 1;
      }
    }
    const failed = writes.length - done;
    const summary =
      failed === 0 ? `Sent ${done} to GitHub` : `Sent ${done} to GitHub, ${failed} failed and ${failed === 1 ? 'stays' : 'stay'} pending`;
    const message = [summary, ...notTaken].join('. ');
    return { ok: failed === 0, message, done, failed, status: status() };
  }

  /** "Send N to GitHub". Refused while writes are off (the lock, or POSTPILE_READ_ONLY=1). A send while one runs joins it. */
  send(queue: MarkReadQueue, status: () => GitHubWritesStatus): Promise<PendingWritesResult> {
    if (!this.sending) {
      this.sending = this.sendAll(queue, status).finally(() => {
        this.sending = null;
      });
    }
    return this.sending;
  }

  /** "Discard": drops every pending write. Nothing changes in the app; the tiles stay unread, like on GitHub. */
  discard(status: () => GitHubWritesStatus): PendingWritesResult {
    const writes = this.list();
    for (const write of writes) {
      this.apply(write, { kind: 'discarded' }, 'footer');
    }
    const message = writes.length === 0 ? 'Nothing pending' : `Discarded ${writes.length}: still unread, like on GitHub`;
    return { ok: true, message, done: writes.length, failed: 0, status: status() };
  }
}
