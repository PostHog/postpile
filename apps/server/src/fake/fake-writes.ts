import {
  indexActionLog,
  pendingWriteStep,
  UNDO_WINDOW_MS,
  type ActionLogEntry,
  type ActionLogIndex,
  type ActionOrigin,
  type GitHubWritesStatus,
  type IsoTime,
  type NewActionLogEntry,
  type NotificationThread,
  type PendingCatchUp,
  type PendingWrite,
  type PendingWriteView,
  type PendingWritesResult,
  type PrKey,
  type ReadScope,
  type TilePendingWrite,
} from '@postpile/core';

const SAMPLE_DETAIL = 'sample data: nothing left the process';
const QUEUED_LOCKED_DETAIL = 'GitHub writes are locked: becomes a pending write after the undo window';
const PENDING_DETAIL = 'GitHub writes are locked: waits until you unlock and send it';
const DISCARDED_DETAIL = 'discarded while locked: stays unread, like on GitHub';
const CLEANUP_PENDING_DETAIL = 'GitHub writes are locked: the cleanup waits until you unlock and send it';
const CLEANUP_DISCARDED_DETAIL = 'cleanup discarded while locked: GitHub keeps them unread';

/** What a click changed in the sample right away (only while writes are on, or with nothing unread on GitHub). */
export interface FakeLocalChange {
  eventIds: string[];
  handledPrKeys: PrKey[];
}

export interface FakeBatch {
  token: string;
  batchId: string;
  origin: ActionOrigin;
  tileId: string | null;
  /** Threads that were unread "on GitHub" when queued. */
  threads: { id: string; prKey: PrKey | null }[];
  prKeys: PrKey[];
  handleKeys: PrKey[];
  local: FakeLocalChange;
  writesOn: boolean;
  queuedAt: number;
}

/** The inbox cleanup parked while locked: its picks, and the threads it covered then (for the count). */
interface FakeCatchUp {
  picks: PendingCatchUp;
  threadIds: string[];
  title: string;
}

interface FakePending {
  id: number;
  createdAt: IsoTime;
  /** A mark-read click. Null for a cleanup. */
  batch: FakeBatch | null;
  /** The inbox cleanup. Null for a mark-read. */
  catchUp: FakeCatchUp | null;
}

/** What FakeWrites needs from FakeEngine's sample data. */
export interface FakeSample {
  /** Puts back what a click changed, when its batch is parked. */
  revert(local: FakeLocalChange): void;
  /** Reads PRs in the sample once their pending write is "sent": what the user saw at `clickedAt` seen, handle keys handled. */
  readHere(scope: ReadScope, clickedAt: IsoTime): void;
  /** Tile or PR title for the footer's pending list. */
  title(prKeys: PrKey[], threadId: string | null): string;
  /** A parked inbox cleanup was sent from the lock: run its plan like the dialog would have. */
  startCatchUp(picks: PendingCatchUp): void;
}

type LogInput = Pick<NewActionLogEntry, 'action' | 'origin' | 'outcome'> & Partial<NewActionLogEntry>;

/**
 * The footer lock, the action log, the deferred queue sends and the pending
 * writes for FakeEngine. Nothing leaves the process: a "send" only flips the
 * sample thread's GitHub unread flag and logs the same rows the real queue
 * would, so the debug view, the lock and pending writes can be tried on
 * sample data. Like the real engine, a batch whose window runs out while
 * locked becomes a pending write and the sample stays unread.
 */
export class FakeWrites {
  private readonly entries: ActionLogEntry[] = [];
  private readonly batches: FakeBatch[] = [];
  private readonly pending: FakePending[] = [];
  /** The sample threads' unread flag "on GitHub", fixed at first sight and changed only by sends. */
  private readonly githubUnread = new Map<string, boolean>();
  private nextId = 1;

  /** `enabled`: how the sample starts. On, like the packaged app with no choice stored; POSTPILE_FAKE_LOCKED=1 starts it locked. */
  constructor(
    private readonly now: () => Date,
    private readonly sample: FakeSample,
    private enabled = true,
  ) {}

  private pendingViews(): PendingWriteView[] {
    return this.pending.map((write): PendingWriteView => {
      if (write.batch === null) {
        return {
          id: write.id,
          kind: 'catch_up',
          createdAt: write.createdAt,
          origin: 'cleanup',
          title: write.catchUp?.title ?? 'Inbox cleanup',
          prKeys: [],
          tileId: null,
          threadCount: write.catchUp?.threadIds.length ?? 0,
          error: null,
        };
      }
      return {
        id: write.id,
        kind: 'mark_read',
        createdAt: write.createdAt,
        origin: write.batch.origin,
        title: this.sample.title(write.batch.prKeys, write.batch.threads[0]?.id ?? null),
        prKeys: write.batch.prKeys,
        tileId: write.batch.tileId,
        threadCount: write.batch.threads.length,
        error: null,
      };
    });
  }

  /** An inbox cleanup waits for the lock. */
  hasCatchUp(): boolean {
    return this.pending.some((write) => write.catchUp !== null);
  }

  /** The inbox cleanup while locked: one pending write, nothing changes in the sample until it is sent. */
  parkCatchUp(picks: PendingCatchUp, threadIds: string[], title: string): void {
    this.pending.push({ id: this.nextId, createdAt: this.now().toISOString(), batch: null, catchUp: { picks, threadIds, title } });
    this.nextId += 1;
    this.record({ action: 'inbox_cleanup', origin: 'cleanup', outcome: 'pending', detail: `${title}: ${CLEANUP_PENDING_DETAIL}` });
  }

  /**
   * One call of a cleanup run "reached GitHub": the sample threads it covers
   * turn read there. `call` is the log row the engine writes for it.
   */
  cleanupCall(threadIds: string[], call: Pick<NewActionLogEntry, 'action' | 'origin'> & Partial<NewActionLogEntry>): void {
    for (const threadId of threadIds) {
      this.githubUnread.set(threadId, false);
    }
    this.record({ ...call, outcome: 'github', detail: call.detail ? `${call.detail}: ${SAMPLE_DETAIL}` : SAMPLE_DETAIL });
  }

  status(): GitHubWritesStatus {
    return { enabled: this.enabled, forcedOffReason: null, pending: this.pendingViews() };
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  record(input: LogInput): ActionLogEntry {
    const entry: ActionLogEntry = {
      id: this.nextId,
      at: this.now().toISOString(),
      threadId: null,
      prKey: null,
      tileId: null,
      batch: null,
      detail: '',
      ...input,
    };
    this.nextId += 1;
    this.entries.push(entry);
    return entry;
  }

  set(enabled: boolean): { ok: boolean; message: string } {
    this.enabled = enabled;
    this.record({ action: enabled ? 'writes_on' : 'writes_off', origin: 'footer', outcome: 'local' });
    const message = enabled
      ? 'GitHub writes on (sample data: nothing leaves the app)'
      : 'GitHub writes locked: mark-reads wait as pending writes, approve and comment are blocked';
    return { ok: true, message };
  }

  /**
   * A sample thread with its GitHub unread flag as the fake queue left it.
   * A thread of a batch queued with writes on reads as read while its undo
   * window runs, like the engine's store: the click reads it here right away
   * and GitHub follows (an undo or a parked batch brings it back).
   */
  onGitHub(thread: NotificationThread): NotificationThread {
    if (!this.githubUnread.has(thread.id)) {
      this.githubUnread.set(thread.id, thread.unread);
    }
    const readHere = this.batches.some((batch) => batch.writesOn && batch.threads.some((queued) => queued.id === thread.id));
    return { ...thread, unread: !readHere && (this.githubUnread.get(thread.id) ?? thread.unread) };
  }

  /** Logs the click the same way ReadMarker does: queued per thread, local for PRs without one that changed right away. */
  queued(batch: FakeBatch): void {
    this.batches.push(batch);
    const base = { action: 'mark_read' as const, origin: batch.origin, tileId: batch.tileId, batch: batch.batchId };
    for (const thread of batch.threads) {
      this.record({ ...base, threadId: thread.id, prKey: thread.prKey, outcome: 'queued', detail: batch.writesOn ? '' : QUEUED_LOCKED_DETAIL });
    }
    if (!batch.writesOn && batch.threads.length > 0) {
      return;
    }
    const queuedKeys = new Set(batch.threads.map((thread) => thread.prKey));
    for (const key of batch.prKeys.filter((candidate) => !queuedKeys.has(candidate))) {
      this.record({ ...base, prKey: key, outcome: 'local', detail: 'no unread GitHub thread' });
    }
  }

  undone(token: string): void {
    const index = this.batches.findIndex((batch) => batch.token === token);
    const batch = this.batches[index];
    if (!batch) {
      return;
    }
    this.batches.splice(index, 1);
    for (const key of batch.prKeys.length > 0 ? batch.prKeys : [null]) {
      this.record({
        action: 'undo_mark_read',
        origin: batch.origin,
        outcome: 'local',
        prKey: key,
        threadId: key === null ? (batch.threads[0]?.id ?? null) : null,
        tileId: batch.tileId,
        batch: batch.batchId,
      });
    }
  }

  private park(batch: FakeBatch): void {
    this.sample.revert(batch.local);
    this.pending.push({ id: this.nextId, createdAt: this.now().toISOString(), batch, catchUp: null });
    this.nextId += 1;
    for (const thread of batch.threads) {
      this.record({
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

  private markThreads(batch: FakeBatch, origin: 'queue' | 'quit' | 'footer'): void {
    for (const thread of batch.threads) {
      this.githubUnread.set(thread.id, false);
      this.record({
        action: 'mark_read',
        origin,
        outcome: 'github',
        threadId: thread.id,
        prKey: thread.prKey,
        tileId: batch.tileId,
        batch: batch.batchId,
        detail: SAMPLE_DETAIL,
      });
    }
  }

  private send(batch: FakeBatch, origin: 'queue' | 'quit'): void {
    if (batch.threads.length === 0) {
      return;
    }
    if (!batch.writesOn || !this.enabled) {
      this.park(batch);
      return;
    }
    this.markThreads(batch, origin);
  }

  /** Sends batches whose undo window ran out. Called before reads, since the fake has no timers. */
  settle(): void {
    const due = this.now().getTime() - UNDO_WINDOW_MS;
    for (const batch of this.batches.filter((candidate) => candidate.queuedAt <= due)) {
      this.batches.splice(this.batches.indexOf(batch), 1);
      this.send(batch, 'queue');
    }
  }

  flush(): void {
    for (const batch of this.batches.splice(0)) {
      this.send(batch, 'quit');
    }
  }

  /** The newest pending write per PR it covers, for the tile marker. */
  pendingByPrKey(): Map<PrKey, TilePendingWrite> {
    const marks = new Map<PrKey, TilePendingWrite>();
    for (const write of this.pending) {
      for (const key of write.batch?.prKeys ?? []) {
        marks.set(key, { since: write.createdAt, error: null });
      }
    }
    return marks;
  }

  /**
   * A sent mark-read through core's `pendingWriteStep`, like the engine's
   * `PendingWrites.apply`: every thread went out (the fake never fails), so
   * their PRs turn read here up to the pending write's time, and PRs without
   * an unread thread follow and are logged as local.
   */
  private completeSent(pending: FakePending, batch: FakeBatch): void {
    const write: PendingWrite = {
      id: pending.id,
      kind: 'mark_read',
      createdAt: pending.createdAt,
      origin: batch.origin,
      tileId: batch.tileId,
      batch: batch.batchId,
      prKeys: batch.prKeys,
      handleKeys: batch.handleKeys,
      threads: batch.threads.map((thread) => ({ id: thread.id, prKey: thread.prKey, updatedAt: pending.createdAt })),
      readBefore: null,
      error: null,
      triedAt: null,
      catchUp: null,
    };
    const step = pendingWriteStep(write, { kind: 'sent', outcomes: write.threads.map(() => ({ kind: 'sent' as const })) });
    for (const effect of step.effects) {
      if (effect.kind === 'read_here') {
        this.sample.readHere({ prKeys: effect.prKeys, handleKeys: batch.handleKeys }, pending.createdAt);
      } else if (effect.kind === 'log_local') {
        this.record({ action: 'mark_read', origin: 'footer', outcome: 'local', prKey: effect.prKey, tileId: batch.tileId, batch: batch.batchId, detail: 'no unread GitHub thread' });
      }
    }
  }

  /** "Send N to GitHub": refused while locked. The fake never fails a send. */
  sendPending(): PendingWritesResult {
    const writes = this.pending.splice(0);
    if (!this.enabled) {
      this.pending.push(...writes);
      return { ok: false, message: 'Not sent: GitHub writes are off. Unlock GitHub writes first.', done: 0, failed: writes.length, status: this.status() };
    }
    for (const write of writes) {
      if (write.batch === null) {
        if (write.catchUp) {
          this.sample.startCatchUp(write.catchUp.picks);
        }
        continue;
      }
      this.markThreads(write.batch, 'footer');
      this.completeSent(write, write.batch);
    }
    return { ok: true, message: `Sent ${writes.length} to GitHub (sample data: nothing left the app)`, done: writes.length, failed: 0, status: this.status() };
  }

  /** "Discard": nothing changes in the sample, the tiles stay unread. */
  discardPending(): PendingWritesResult {
    const writes = this.pending.splice(0);
    for (const write of writes) {
      if (write.batch === null) {
        this.record({ action: 'inbox_cleanup', origin: 'footer', outcome: 'discarded', detail: `${write.catchUp?.title ?? 'Inbox cleanup'}: ${CLEANUP_DISCARDED_DETAIL}` });
        continue;
      }
      for (const thread of write.batch.threads) {
        this.record({
          action: 'mark_read',
          origin: 'footer',
          outcome: 'discarded',
          threadId: thread.id,
          prKey: thread.prKey,
          tileId: write.batch.tileId,
          batch: write.batch.batchId,
          detail: DISCARDED_DETAIL,
        });
      }
    }
    const message = writes.length === 0 ? 'Nothing pending' : `Discarded ${writes.length}: still unread, like on GitHub`;
    return { ok: true, message, done: writes.length, failed: 0, status: this.status() };
  }

  index(): ActionLogIndex {
    return indexActionLog(this.entries);
  }

  recent(limit: number): ActionLogEntry[] {
    return this.entries.toReversed().slice(0, limit);
  }
}
