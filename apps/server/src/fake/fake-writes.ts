import {
  indexActionLog,
  type ActionLogEntry,
  type ActionLogIndex,
  type ActionOrigin,
  type GitHubWritesStatus,
  type IsoTime,
  type NewActionLogEntry,
  type NotificationThread,
  type PendingWriteView,
  type PendingWritesResult,
  type PrKey,
  type TilePendingWrite,
} from '@postpile/core';
import { UNDO_WINDOW_MS } from '@postpile/engine';

const SAMPLE_DETAIL = 'sample data: nothing left the process';
const QUEUED_LOCKED_DETAIL = 'GitHub writes are locked: becomes a pending write after the undo window';
const PENDING_DETAIL = 'GitHub writes are locked: waits until you unlock and send it';
const DISCARDED_DETAIL = 'discarded while locked: stays unread, like on GitHub';

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

interface FakePending {
  id: number;
  createdAt: IsoTime;
  /** A mark-read click. Null for a cleanup. */
  batch: FakeBatch | null;
  /** The inbox cleanup's cutoff. Null for a mark-read. */
  readBefore: IsoTime | null;
}

/** What FakeWrites needs from FakeEngine's sample data. */
export interface FakeSample {
  /** Puts back what a click changed, when its batch is parked. */
  revert(local: FakeLocalChange): void;
  /** Marks PRs read in the sample, once their pending write is "sent". */
  markReadHere(prKeys: PrKey[], handleKeys: PrKey[]): void;
  /** Tile or PR title for the footer's pending list. */
  title(prKeys: PrKey[], threadId: string | null): string;
  /** Ids of sample threads unread "on GitHub" with no activity since `cutoff`. */
  unreadBefore(cutoff: IsoTime): string[];
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
  private enabled = false;
  private readonly entries: ActionLogEntry[] = [];
  private readonly batches: FakeBatch[] = [];
  private readonly pending: FakePending[] = [];
  /** The sample threads' unread flag "on GitHub", fixed at first sight and changed only by sends. */
  private readonly githubUnread = new Map<string, boolean>();
  private nextId = 1;

  constructor(
    private readonly now: () => Date,
    private readonly sample: FakeSample,
  ) {}

  private pendingViews(): PendingWriteView[] {
    return this.pending.map((write): PendingWriteView => {
      if (write.batch === null) {
        const cutoff = write.readBefore ?? '';
        return {
          id: write.id,
          kind: 'mark_all_read_before',
          createdAt: write.createdAt,
          origin: 'cleanup',
          title: `Cleanup: mark everything before ${cutoff.slice(0, 10)} read`,
          prKeys: [],
          tileId: null,
          threadCount: this.sample.unreadBefore(cutoff).length,
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

  /** The cleanup's cutoff while one waits for the lock. */
  pendingCleanupCutoff(): IsoTime | null {
    return this.pending.filter((write) => write.batch === null).at(-1)?.readBefore ?? null;
  }

  /**
   * "Mark everything before `cutoff` read on GitHub": flips the sample
   * threads right away while unlocked, else one pending write. Returns
   * whether it went out.
   */
  cleanup(cutoff: IsoTime): boolean {
    const detail = `last_read_at=${cutoff}`;
    if (!this.enabled) {
      this.pending.push({ id: this.nextId, createdAt: this.now().toISOString(), batch: null, readBefore: cutoff });
      this.nextId += 1;
      this.record({ action: 'mark_all_read_before', origin: 'cleanup', outcome: 'pending', detail: `${detail}: ${PENDING_DETAIL}` });
      return false;
    }
    this.markBefore(cutoff, 'cleanup');
    return true;
  }

  private markBefore(cutoff: IsoTime, origin: 'cleanup' | 'footer'): void {
    for (const threadId of this.sample.unreadBefore(cutoff)) {
      this.githubUnread.set(threadId, false);
    }
    this.record({ action: 'mark_all_read_before', origin, outcome: 'github', detail: `last_read_at=${cutoff}: ${SAMPLE_DETAIL}` });
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

  /** A sample thread with its GitHub unread flag as the fake queue left it. */
  onGitHub(thread: NotificationThread): NotificationThread {
    if (!this.githubUnread.has(thread.id)) {
      this.githubUnread.set(thread.id, thread.unread);
    }
    return { ...thread, unread: this.githubUnread.get(thread.id) ?? thread.unread };
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
    this.pending.push({ id: this.nextId, createdAt: this.now().toISOString(), batch, readBefore: null });
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

  /** "Send N to GitHub": refused while locked. The fake never fails a send. */
  sendPending(): PendingWritesResult {
    const writes = this.pending.splice(0);
    if (!this.enabled) {
      this.pending.push(...writes);
      return { ok: false, message: 'Not sent: GitHub writes are off. Unlock GitHub writes first.', done: 0, failed: writes.length, status: this.status() };
    }
    for (const write of writes) {
      if (write.batch === null) {
        this.markBefore(write.readBefore ?? '', 'footer');
        continue;
      }
      this.markThreads(write.batch, 'footer');
      this.sample.markReadHere(write.batch.prKeys, write.batch.handleKeys);
    }
    return { ok: true, message: `Sent ${writes.length} to GitHub (sample data: nothing left the app)`, done: writes.length, failed: 0, status: this.status() };
  }

  /** "Discard": nothing changes in the sample, the tiles stay unread. */
  discardPending(): PendingWritesResult {
    const writes = this.pending.splice(0);
    for (const write of writes) {
      if (write.batch === null) {
        this.record({ action: 'mark_all_read_before', origin: 'footer', outcome: 'discarded', detail: `last_read_at=${write.readBefore ?? ''}: ${DISCARDED_DETAIL}` });
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
