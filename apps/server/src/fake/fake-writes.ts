import {
  indexActionLog,
  type ActionLogEntry,
  type ActionLogIndex,
  type ActionOrigin,
  type GitHubWritesChange,
  type GitHubWritesStatus,
  type NewActionLogEntry,
  type NotificationThread,
  type PrKey,
} from '@postpile/core';
import { UNDO_WINDOW_MS } from '@postpile/engine';

const SAMPLE_DETAIL = 'sample data: nothing left the process';

export interface FakeBatch {
  token: string;
  batchId: string;
  origin: ActionOrigin;
  tileId: string | null;
  /** Threads that were unread "on GitHub" when queued. */
  threads: { id: string; prKey: PrKey | null }[];
  prKeys: PrKey[];
  writesOn: boolean;
  queuedAt: number;
}

type LogInput = Pick<NewActionLogEntry, 'action' | 'origin' | 'outcome'> & Partial<NewActionLogEntry>;

/**
 * The footer lock, the action log and the deferred queue sends for
 * FakeEngine. Nothing leaves the process: a "send" only flips the sample
 * thread's GitHub unread flag and logs the same rows the real queue would,
 * so the debug view and the lock can be tried on sample data.
 */
export class FakeWrites {
  private enabled = false;
  private readonly entries: ActionLogEntry[] = [];
  private readonly batches: FakeBatch[] = [];
  /** The sample threads' unread flag "on GitHub", fixed at first sight and changed only by sends. */
  private readonly githubUnread = new Map<string, boolean>();
  private nextId = 1;

  constructor(private readonly now: () => Date) {}

  status(): GitHubWritesStatus {
    return { enabled: this.enabled, forcedOffReason: null };
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

  set(enabled: boolean): GitHubWritesChange {
    this.enabled = enabled;
    this.record({ action: enabled ? 'writes_on' : 'writes_off', origin: 'footer', outcome: 'local' });
    const message = enabled ? 'GitHub writes on (sample data: nothing leaves the app)' : 'GitHub writes off: actions stay in the app';
    return { ok: true, message, status: this.status() };
  }

  /** A sample thread with its GitHub unread flag as the fake queue left it. */
  onGitHub(thread: NotificationThread): NotificationThread {
    if (!this.githubUnread.has(thread.id)) {
      this.githubUnread.set(thread.id, thread.unread);
    }
    return { ...thread, unread: this.githubUnread.get(thread.id) ?? thread.unread };
  }

  /** Logs the click the same way ReadMarker does: queued or local per thread, local for PRs without one. */
  queued(batch: FakeBatch): void {
    this.batches.push(batch);
    const base = { action: 'mark_read' as const, origin: batch.origin, tileId: batch.tileId, batch: batch.batchId };
    for (const thread of batch.threads) {
      this.record({
        ...base,
        threadId: thread.id,
        prKey: thread.prKey,
        outcome: batch.writesOn ? 'queued' : 'local',
        detail: batch.writesOn ? '' : 'GitHub writes are off',
      });
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

  private send(batch: FakeBatch, origin: 'queue' | 'quit'): void {
    if (!batch.writesOn) {
      return;
    }
    for (const thread of batch.threads) {
      const base = { action: 'mark_read' as const, origin, threadId: thread.id, prKey: thread.prKey, tileId: batch.tileId, batch: batch.batchId };
      if (!this.enabled) {
        this.record({ ...base, outcome: 'local', detail: 'GitHub writes were turned off before it was sent' });
        continue;
      }
      this.githubUnread.set(thread.id, false);
      this.record({ ...base, outcome: 'github', detail: SAMPLE_DETAIL });
    }
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

  index(): ActionLogIndex {
    return indexActionLog(this.entries);
  }

  recent(limit: number): ActionLogEntry[] {
    return this.entries.toReversed().slice(0, limit);
  }
}
