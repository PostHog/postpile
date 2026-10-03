import {
  CLEANUP_ALREADY_PENDING,
  SAFE_CLEAR_WAITS_FOR_SYNC,
  cleanupCounts,
  cleanupOptions,
  cleanupPicksWords,
  planCleanup,
  planPendingCleanup,
  planThreadCleanup,
  safeMergedIds,
  startCase,
  type ActionResult,
  type CleanupPlan,
  type CleanupProgress,
  type CleanupRequest,
  type CleanupRunResult,
  type CleanupThread,
  type InboxCleanupView,
  type IsoTime,
  type PendingCatchUp,
  type PrKey,
  type SafeCleanupRequest,
} from '@postpile/core';
import type { FakeWrites } from './fake-writes.ts';

/** One call of a fake run: the sample threads it covers and the log row it writes. */
interface FakeCall {
  threadIds: string[];
  action: 'mark_all_read_before' | 'mark_read';
  threadId: string | null;
  prKey: PrKey | null;
  detail: string;
}

function ok(message: string): ActionResult {
  return { ok: true, message, undoToken: null };
}

/** The plan's calls in order, each with the sample threads it covers. */
function callsOf(plan: CleanupPlan, prKeyOf: (threadId: string) => PrKey | null): FakeCall[] {
  const calls: FakeCall[] = [];
  if (plan.readBefore !== null) {
    calls.push({ threadIds: plan.readBeforeIds, action: 'mark_all_read_before', threadId: null, prKey: null, detail: `last_read_at=${plan.readBefore}` });
  }
  for (const { repo, ids } of plan.repos) {
    calls.push({ threadIds: ids, action: 'mark_all_read_before', threadId: null, prKey: null, detail: `repo=${repo} last_read_at=${plan.at}` });
  }
  for (const id of plan.threadIds) {
    calls.push({ threadIds: [id], action: 'mark_read', threadId: id, prKey: prKeyOf(id), detail: '' });
  }
  return calls;
}

export interface FakeCleanupDeps {
  now: () => Date;
  writes: FakeWrites;
  prKeyOf: (threadId: string) => PrKey | null;
  /** A run ended: a held fake sync goes on. */
  afterRun: () => void;
  /** Time per call, so the progress can be watched. */
  stepMs: number;
}

/**
 * The inbox catch-up on sample data, with core's rules: every fake start
 * counts as a first run until the dialog is answered, and a run "clears"
 * one call per step by flipping the sample threads' GitHub unread flag.
 * Nothing leaves the process.
 */
export class FakeCleanup {
  private answered = false;
  private progress: CleanupProgress | null = null;
  private lastRun: CleanupRunResult | null = null;
  private running = false;
  private changes = 0;

  constructor(private readonly deps: FakeCleanupDeps) {}

  private startCaseFor(threads: CleanupThread[], at: IsoTime) {
    const counts = cleanupCounts(threads, at);
    return startCase({
      reason: this.answered ? null : { kind: 'first_run' },
      now: at,
      unread: counts.unread,
      mergedUnread: counts.mergedAll,
      answeredMerged: null,
    });
  }

  /** After the fake sync's fetch step: the start dialog is due. */
  holds(threads: CleanupThread[]): boolean {
    return this.startCaseFor(threads, this.deps.now().toISOString()) !== null;
  }

  view(threads: CleanupThread[], glances: number, held: boolean, syncing: boolean): InboxCleanupView {
    const at = this.deps.now().toISOString();
    return {
      countedAt: at,
      counts: cleanupCounts(threads, at),
      glances: held ? glances : 0,
      options: cleanupOptions(threads, at),
      start: held ? this.startCaseFor(threads, at) : null,
      running: this.progress ? { ...this.progress } : null,
      lastRun: this.lastRun,
      pending: this.deps.writes.hasCatchUp(),
      syncing,
    };
  }

  isRunning(): boolean {
    return this.running;
  }

  /** Counted into the live status' changeCount, so tiles follow the run. */
  changeCount(): number {
    return this.changes;
  }

  startAsUsual(): ActionResult {
    this.answered = true;
    return ok('Starting as usual');
  }

  /** Like the engine: one run at a time, and only one cleanup waits in the lock. */
  private refusal(): ActionResult | null {
    if (this.running) {
      return { ok: false, message: 'A cleanup is already running', undoToken: null };
    }
    if (!this.deps.writes.isEnabled() && this.deps.writes.hasCatchUp()) {
      return { ok: false, message: CLEANUP_ALREADY_PENDING, undoToken: null };
    }
    return null;
  }

  private countedAt(requested: IsoTime): IsoTime {
    const now = this.deps.now().toISOString();
    return requested < now ? requested : now;
  }

  /** Locked, one pending write; else the run starts. */
  private send(plan: CleanupPlan, catchUp: PendingCatchUp): ActionResult {
    if (plan.clears === 0) {
      return ok('Nothing to clear');
    }
    if (!this.deps.writes.isEnabled()) {
      this.deps.writes.parkCatchUp(catchUp, plan.selectedIds, `Inbox cleanup: ${cleanupPicksWords(catchUp)}`);
      return ok(`Pending: clears ${plan.clears} on GitHub once you unlock and send it from the lock`);
    }
    void this.run(plan, 'cleanup');
    return ok(`Clearing ${plan.clears} on GitHub in the background`);
  }

  clear(request: CleanupRequest, threads: CleanupThread[]): ActionResult {
    const refused = this.refusal();
    if (refused !== null) {
      return refused;
    }
    const at = this.countedAt(request.countedAt);
    if (request.from === 'start') {
      this.answered = true;
    }
    return this.send(planCleanup(threads, request, at), { merged: request.merged, older: request.older, countedAt: at });
  }

  /** The sidebar's "look safe" item: the explicit list of merged samples whose glance says LOOKS_SAFE or NOT_YOURS. */
  clearSafe(request: SafeCleanupRequest, threads: CleanupThread[], syncing: boolean): ActionResult {
    if (syncing) {
      return { ok: false, message: SAFE_CLEAR_WAITS_FOR_SYNC, undoToken: null };
    }
    const refused = this.refusal();
    if (refused !== null) {
      return refused;
    }
    const at = this.countedAt(request.countedAt);
    const ids = safeMergedIds(threads, at);
    return this.send(planThreadCleanup(threads, ids, at), { merged: null, older: null, countedAt: at, threadIds: ids });
  }

  /** A parked cleanup sent from the lock. */
  startFromPending(pending: PendingCatchUp, threads: CleanupThread[]): void {
    const plan = planPendingCleanup(threads, pending);
    if (!this.running && plan.clears > 0) {
      void this.run(plan, 'footer');
    }
  }

  private async run(plan: CleanupPlan, origin: 'cleanup' | 'footer'): Promise<void> {
    this.running = true;
    this.progress = { done: 0, total: plan.clears, merged: plan.mergedClears > 0 };
    const batch = `cleanup:${this.deps.now().getTime()}`;
    let marked = 0;
    for (const call of callsOf(plan, this.deps.prKeyOf)) {
      await new Promise((resolve) => setTimeout(resolve, this.deps.stepMs));
      this.deps.writes.cleanupCall(call.threadIds, { action: call.action, origin, batch, threadId: call.threadId, prKey: call.prKey, detail: call.detail });
      marked += call.threadIds.length;
      this.progress.done = marked;
      this.changes += 1;
    }
    this.deps.writes.record({ action: 'inbox_cleanup', origin, outcome: 'github', batch, detail: `marked ${marked} read on GitHub` });
    this.lastRun = { id: batch, marked, failed: 0, stillOnGitHub: 0, at: this.deps.now().toISOString() };
    this.progress = null;
    this.running = false;
    this.deps.afterRun();
  }
}
