// The running sync's progress, stored for other processes. The MCP server
// reads the database through its own read-only connection and cannot ask
// the app's SyncRun, so the app keeps a copy in meta while a sync runs.
import { SYNC_PROGRESS_HEARTBEAT_MS, type RecordedSyncProgress, type SyncProgress } from '@postpile/core';
import type { Store } from '@postpile/store';
import { errorText } from './errors.ts';

export const SYNC_PROGRESS_KEY = 'sync_progress';

/** How often the recorder looks at the progress; it writes only when something moved, or for the heartbeat. */
export const SYNC_PROGRESS_CHECK_MS = 5_000;

export function loadSyncProgress(store: Store): RecordedSyncProgress | null {
  const raw = store.meta.get(SYNC_PROGRESS_KEY);
  return raw ? (JSON.parse(raw) as RecordedSyncProgress) : null;
}

/** The parts other processes read; the per-kind stats stay in the app. */
function recordedParts(progress: SyncProgress): Omit<RecordedSyncProgress, 'savedAt'> {
  return {
    startedAt: progress.startedAt,
    running: progress.running,
    agentCallsDone: progress.agentCallsDone,
    agentCallsPlanned: progress.agentCallsPlanned,
    fromGitHub: progress.fromGitHub,
    prsRead: progress.prsRead,
  };
}

/**
 * Keeps meta sync_progress in step with one running sync: written at the
 * start and on every phase change (SyncRun calls `save`), else checked every
 * SYNC_PROGRESS_CHECK_MS and written when a count or the fetch result moved,
 * or when SYNC_PROGRESS_HEARTBEAT_MS passed (readers take an old record for
 * a crashed app). Agent calls finish many a second, so they only go out with
 * the check. Removed at the end. A failed write only logs: the sync never
 * fails over it.
 */
export class SyncProgressRecorder {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastParts = '';
  private lastSavedMs = 0;

  constructor(
    private readonly store: Store,
    private readonly now: () => Date,
    private readonly read: () => SyncProgress | null,
    private readonly log: (line: string) => void,
  ) {}

  /** Writes the record now and starts the checks. */
  start(): void {
    this.save();
    this.timer = setInterval(() => this.save(), SYNC_PROGRESS_CHECK_MS);
    this.timer.unref?.();
  }

  /** Writes the record when something moved since the last write, or the heartbeat is due. */
  save(): void {
    const progress = this.read();
    if (progress === null) {
      return;
    }
    const parts = recordedParts(progress);
    const text = JSON.stringify(parts);
    const nowMs = this.now().getTime();
    if (text === this.lastParts && nowMs - this.lastSavedMs < SYNC_PROGRESS_HEARTBEAT_MS) {
      return;
    }
    const record: RecordedSyncProgress = { ...parts, savedAt: new Date(nowMs).toISOString() };
    try {
      this.store.meta.set(SYNC_PROGRESS_KEY, JSON.stringify(record));
      this.lastParts = text;
      this.lastSavedMs = nowMs;
    } catch (error) {
      this.log(`sync: could not store the progress: ${errorText(error)}`);
    }
  }

  /** Stops the checks and removes the record: the sync ended, finished or not. */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    try {
      this.store.meta.delete(SYNC_PROGRESS_KEY);
    } catch (error) {
      this.log(`sync: could not remove the progress: ${errorText(error)}`);
    }
  }
}
