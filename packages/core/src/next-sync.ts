import type { AgentCallStats } from './memory.ts';
import type { IsoTime } from './types.ts';

/**
 * The run's agent-call cap skipped work while its calls got somewhere: some
 * kind has skippedByBudget and at least one call came back without failing.
 * A cap of 0 (or an agent that fails every call) skips everything every
 * run, so it never counts as work left over.
 */
export function agentWorkLeftOver(stats: AgentCallStats): boolean {
  let skipped = false;
  let succeeded = false;
  for (const count of Object.values(stats.byKind)) {
    if (!count) {
      continue;
    }
    skipped ||= count.skippedByBudget > 0;
    succeeded ||= count.calls > count.failed;
  }
  return skipped && succeeded;
}

/** How a full sync ended, as far as the next background sync cares. */
export interface SyncEnd {
  /** Held for the inbox catch-up dialog: its answer starts the next sync. */
  heldForCatchUp: boolean;
  /** PRs left over by the PR cap (SYNC_MAX_PRS). */
  prsSkipped: number;
  /** The board is full (isBoardFull): what it would cut is not worth a sync every few minutes. */
  boardFull: boolean;
  agentCallStats: AgentCallStats;
}

/**
 * Whether the sync left a backlog, so the next background sync comes after
 * BACKLOG_SYNC_MINUTES instead of the full interval (DESIGN.md "Memory on
 * big boards"): PRs over the PR cap while the board has room, or agent work
 * the call cap skipped. A held sync never: another one would only fetch
 * and hold again.
 */
export function syncLeftBacklog(end: SyncEnd): boolean {
  if (end.heldForCatchUp) {
    return false;
  }
  if (end.prsSkipped > 0 && !end.boardFull) {
    return true;
  }
  return agentWorkLeftOver(end.agentCallStats);
}

/** One bulk mark-read PostPile sent: `PUT /notifications` (repo null) or `PUT /repos/{repo}/notifications`, with its last_read_at. */
export interface BulkRead {
  repo: string | null;
  lastReadAt: IsoTime;
}

/**
 * When one of PostPile's own bulk mark-reads covers the thread as stored,
 * the latest such last_read_at, else null. GitHub reads every thread in the
 * call's scope whose activity is not newer than last_read_at, so a thread
 * with newer activity was not read by the call.
 */
export function ownBulkReadAt(reads: BulkRead[], thread: { repo: string; updatedAt: IsoTime }): IsoTime | null {
  let latest: IsoTime | null = null;
  for (const read of reads) {
    if (read.repo !== null && read.repo !== thread.repo) {
      continue;
    }
    if (thread.updatedAt > read.lastReadAt) {
      continue;
    }
    if (latest === null || read.lastReadAt > latest) {
      latest = read.lastReadAt;
    }
  }
  return latest;
}
