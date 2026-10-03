import {
  CATCH_UP_CONFIRM_TRIES,
  catchUpReason,
  CLEANUP_ALREADY_PENDING,
  SAFE_CLEAR_WAITS_FOR_SYNC,
  cleanupCounts,
  cleanupOptions,
  isUnseenMergeWithoutReview,
  planCleanup,
  planPendingCleanup,
  planThreadCleanup,
  prReadScope,
  safeMergedIds,
  startCase,
  threadPrKey,
  type ActionResult,
  type CatchUpReason,
  type CleanupGlance,
  type CleanupPlan,
  type CleanupProgress,
  type CleanupRequest,
  type CleanupRunResult,
  type CleanupThread,
  type InboxCleanupView,
  type IsoTime,
  type PendingCatchUp,
  type PendingThread,
  type PendingWrite,
  type PrKey,
  type SafeCleanupRequest,
  type StartCase,
} from '@postpile/core';
import type { Store } from '@postpile/store';
import { errorText } from '../errors.ts';
import { advanceSeenFromGitHub } from '../memory/seen-from-github.ts';
import type { Telemetry } from '../telemetry/telemetry.ts';
import type { GitHubWrites } from '../writes/github-writes.ts';
import type { PendingWrites } from '../writes/pending-writes.ts';
import { readLocally } from './local-change.ts';
import { failed, ok } from './results.ts';

const LAST_SYNC_KEY = 'last_sync_started_at';
/** Why the start dialog may be due (CatchUpReason JSON), from the sync start until it is answered or not needed. */
const REASON_KEY = 'catch_up_reason';
/** Unread merged PRs left after the last answer to the start dialog. */
const ANSWERED_KEY = 'catch_up_answered_merged';

/**
 * Called at the start of every full sync. A first run, or the first sync
 * after CATCH_UP_BACK_DAYS or more, notes why the start dialog may be due.
 * A reason still waiting for an answer (the app quit before it) stays. A
 * store from before last_sync_started_at existed uses its newest PR fetch.
 */
export function noteSyncStart(store: Store, at: IsoTime): void {
  const previous = store.meta.get(LAST_SYNC_KEY) ?? [...store.prs.fetchedAtByKey().values()].sort().at(-1) ?? null;
  const reason = catchUpReason(previous, at);
  if (reason !== null && store.meta.get(REASON_KEY) === null) {
    store.meta.set(REASON_KEY, JSON.stringify(reason));
  }
  store.meta.set(LAST_SYNC_KEY, at);
}

/** The inbox catch-up's say over a full sync (DESIGN.md "Inbox cleanup" › Before agent work). */
export interface CatchUpGate {
  /** At every sync start. */
  noteStart(at: IsoTime): void;
  /** After the fetch: true while the start dialog is due, so the sync's agent work waits for its answer. */
  holds(): boolean;
}

export interface InboxCleanupDeps {
  store: Store;
  writes: GitHubWrites;
  pendingWrites: PendingWrites;
  now: () => Date;
  /** Only an app with a window asks before agent work; the CLI's syncs never hold. */
  asksOnStart: boolean;
  /** PRs the coming sync would glance (pendingGlanceKeys). */
  pendingGlances: () => Set<PrKey>;
  /** The stored glances of these PRs, each with whether it is stale or being written. Reads only, never starts a glance. */
  glances: (keys: PrKey[]) => Map<PrKey, CleanupGlance>;
  /** A full sync runs its fetch or agent steps (not held): its dossier and glance steps may rewrite a glance. */
  syncRunning: () => boolean;
  /** Waits between two per-thread mark-reads (CATCH_UP_PACE_MS in the app). */
  pause: () => Promise<void>;
  /** Ids of the threads GitHub's inbox lists unread right now (a plain read, nothing stored). */
  unreadOnGitHub: () => Promise<Set<string>>;
  /** Waits between two of those reads while a bulk PUT finishes (CATCH_UP_CONFIRM_EVERY_MS in the app). */
  waitForGitHub: () => Promise<void>;
  /** A run ended: the engine resumes a held sync, or reads the inbox again so the bulk calls show. */
  afterRun: () => void;
  telemetry: Telemetry;
  log: (line: string) => void;
}

/** A thread's PR events up to its last activity seen, like a read on GitHub; the thread read here. */
function mirrorRead(store: Store, thread: { id: string; updatedAt: IsoTime }, prKey: PrKey | null): void {
  store.notifications.markRead(thread.id, thread.updatedAt);
  if (prKey !== null) {
    readLocally(store, prReadScope(prKey, false), { kind: 'read_on_github', readAt: thread.updatedAt }, thread.updatedAt);
  }
}

/**
 * The inbox catch-up dialog (DESIGN.md "Inbox cleanup"): counts unread
 * threads on merged PRs and old ones, decides whether the start dialog is
 * due, and clears the picks on GitHub in the background through the writes
 * door (locked, they wait as one pending write). Each per-thread mark-read
 * also reads the thread here, so tiles go done and topics can retire; the
 * bulk PUTs may finish later on GitHub (202), so the run waits, bounded,
 * until the inbox shows their threads read, and they show up here through
 * the next inbox read.
 */
export class InboxCleanup implements CatchUpGate {
  private running: Promise<void> | null = null;
  private progress: CleanupProgress | null = null;
  private lastRun: CleanupRunResult | null = null;
  /** Calls that landed; counted into the live status' changeCount so tiles follow the run. */
  private changes = 0;

  constructor(private readonly deps: InboxCleanupDeps) {}

  noteStart(at: IsoTime): void {
    noteSyncStart(this.deps.store, at);
  }

  private reason(): CatchUpReason | null {
    const stored = this.deps.store.meta.get(REASON_KEY);
    return stored === null ? null : (JSON.parse(stored) as CatchUpReason);
  }

  /** Every unread thread, with what PostPile knows about its PR. */
  private threads(glanced: Set<PrKey>): CleanupThread[] {
    const { store } = this.deps;
    const unread = store.notifications.list().filter((thread) => thread.unread);
    const keys = unread.flatMap((thread) => threadPrKey(thread) ?? []);
    const prs = store.prs.getMany(keys);
    const isMerged = (key: PrKey | null) => key !== null && prs.get(key)?.state === 'MERGED';
    const mergedKeys = keys.filter(isMerged);
    const events = store.events.listForPrs(mergedKeys);
    const glances = this.deps.glances(mergedKeys);
    return unread.map((thread) => {
      const key = threadPrKey(thread);
      const merged = isMerged(key);
      return {
        id: thread.id,
        repo: thread.repo,
        updatedAt: thread.updatedAt,
        merged,
        withoutReview: merged && key !== null && (events.get(key) ?? []).some(isUnseenMergeWithoutReview),
        glanced: key !== null && glanced.has(key),
        glance: merged && key !== null ? (glances.get(key) ?? null) : null,
      };
    });
  }

  private startCaseFor(threads: CleanupThread[], at: IsoTime): StartCase | null {
    const counts = cleanupCounts(threads, at);
    const answered = this.deps.store.meta.get(ANSWERED_KEY);
    return startCase({
      reason: this.reason(),
      now: at,
      unread: counts.unread,
      mergedUnread: counts.mergedAll,
      answeredMerged: answered === null ? null : Number(answered),
    });
  }

  holds(): boolean {
    const at = this.deps.now().toISOString();
    if (this.deps.asksOnStart && this.reason() !== null && this.startCaseFor(this.threads(new Set()), at) !== null) {
      return true;
    }
    // Not due (or nobody to ask): the sync runs through, and this start's question is settled.
    this.deps.store.meta.delete(REASON_KEY);
    return false;
  }

  /** `held`: a sync waits for the start dialog. The glance count (saving line) is only worked out then. */
  view(held: boolean): InboxCleanupView {
    const at = this.deps.now().toISOString();
    const glanced = held ? this.deps.pendingGlances() : new Set<PrKey>();
    const threads = this.threads(glanced);
    return {
      countedAt: at,
      counts: cleanupCounts(threads, at),
      glances: glanced.size,
      options: cleanupOptions(threads, at),
      start: held ? this.startCaseFor(threads, at) : null,
      running: this.progress ? { ...this.progress } : null,
      lastRun: this.lastRun,
      pending: this.deps.pendingWrites.hasCatchUp(),
      syncing: this.deps.syncRunning(),
    };
  }

  isRunning(): boolean {
    return this.running !== null;
  }

  /** For tests: settles when the background run did. */
  settled(): Promise<void> {
    return this.running ?? Promise.resolve();
  }

  /** The start dialog is answered: it comes back once CATCH_UP_MERGED_THRESHOLD more merged PRs pile up, or at the next long gap. */
  private answer(mergedLeft: number): void {
    this.deps.store.meta.set(ANSWERED_KEY, String(mergedLeft));
    this.deps.store.meta.delete(REASON_KEY);
  }

  /** "Start as usual" (or Esc) on the start dialog. */
  startAsUsual(): ActionResult {
    const at = this.deps.now().toISOString();
    this.answer(cleanupCounts(this.threads(new Set()), at).mergedAll);
    return ok('Starting as usual');
  }

  /** Why a new cleanup cannot go now: one runs, or one already waits in the lock. Null when it can. */
  private refusal(): string | null {
    if (this.running) {
      return 'A cleanup is already running';
    }
    if (!this.deps.writes.enabled() && this.deps.pendingWrites.hasCatchUp()) {
      return CLEANUP_ALREADY_PENDING;
    }
    return null;
  }

  /** Never past the time the dialog (or the sidebar line) counted. */
  private countedAt(requested: IsoTime): IsoTime {
    const now = this.deps.now().toISOString();
    return requested < now ? requested : now;
  }

  /** Locked, the plan waits as one pending write (`catchUp` is what Send plans again); otherwise its run starts in the background. */
  private send(plan: CleanupPlan, catchUp: PendingCatchUp): ActionResult {
    if (plan.clears === 0) {
      return ok('Nothing to clear');
    }
    const batch = `cleanup:${this.deps.now().getTime()}`;
    if (!this.deps.writes.enabled()) {
      this.deps.pendingWrites.parkCatchUp(catchUp, this.pendingThreads(plan), batch);
      return ok(`Pending: clears ${plan.clears} on GitHub once you unlock and send it from the lock`);
    }
    this.start(plan, 'cleanup', batch);
    return ok(`Clearing ${plan.clears} on GitHub in the background`);
  }

  /**
   * "Clear N": plans the calls over what is stored now, never past the time
   * the dialog counted. Locked, the picks wait as one pending write.
   * Otherwise the run starts in the background and this answers at once.
   */
  clear(request: CleanupRequest): ActionResult {
    const refused = this.refusal();
    if (refused !== null) {
      return failed(refused);
    }
    const at = this.countedAt(request.countedAt);
    const threads = this.threads(new Set());
    const plan = planCleanup(threads, request, at);
    if (request.from === 'start') {
      this.answer(cleanupCounts(threads, at).mergedAll - plan.mergedClears);
    }
    return this.send(plan, { merged: request.merged, older: request.older, countedAt: at });
  }

  /**
   * The sidebar's "N of them look safe · Clear": only the merged PRs whose
   * current glance says LOOKS_SAFE or NOT_YOURS, as an explicit thread list
   * through the same plan, run and lock. Reads the glances that exist; never
   * starts or queues one. Refused while a full sync runs: a glance read as
   * LOOKS_SAFE now may be LOOK_CLOSER once its glance step wrote.
   */
  clearSafe(request: SafeCleanupRequest): ActionResult {
    if (this.deps.syncRunning()) {
      return failed(SAFE_CLEAR_WAITS_FOR_SYNC);
    }
    const refused = this.refusal();
    if (refused !== null) {
      return failed(refused);
    }
    const at = this.countedAt(request.countedAt);
    const threads = this.threads(new Set());
    const ids = safeMergedIds(threads, at);
    return this.send(planThreadCleanup(threads, ids, at), { merged: null, older: null, countedAt: at, threadIds: ids });
  }

  /** A parked cleanup sent from the lock: the same plan over what is stored now. Null when it started (or had nothing left), else why not. */
  startFromPending(write: PendingWrite): string | null {
    if (write.catchUp === null) {
      return 'not a cleanup';
    }
    if (this.running) {
      return 'another cleanup is running';
    }
    const plan = planPendingCleanup(this.threads(new Set()), write.catchUp);
    if (plan.clears > 0) {
      this.start(plan, 'footer', write.batch);
    }
    return null;
  }

  private pendingThreads(plan: CleanupPlan): PendingThread[] {
    const selected = new Set(plan.selectedIds);
    return this.deps.store.notifications
      .list()
      .filter((thread) => selected.has(thread.id))
      .map((thread) => ({ id: thread.id, updatedAt: thread.updatedAt, prKey: threadPrKey(thread) }));
  }

  private start(plan: CleanupPlan, origin: 'cleanup' | 'footer', batch: string): void {
    this.progress = { done: 0, total: plan.clears, merged: plan.mergedClears > 0 };
    this.running = this.run(plan, origin, batch)
      .catch((error: unknown) => this.deps.log(`inbox cleanup: failed: ${errorText(error)}`))
      .finally(() => {
        this.running = null;
        this.progress = null;
        this.deps.afterRun();
      });
  }

  private advance(count: number): void {
    this.changes += 1;
    if (this.progress) {
      this.progress.done += count;
    }
  }

  changeCount(): number {
    return this.changes;
  }

  /**
   * GitHub may take a bulk PUT with 202 and finish it later. Reads the inbox
   * until the threads it covered left it, at most CATCH_UP_CONFIRM_TRIES
   * times; the held sync waits for this, so its fetch sees them read.
   * Returns how many GitHub still lists unread.
   */
  private async confirmBulk(ids: string[]): Promise<number> {
    let waiting = ids;
    for (let attempt = 0; attempt < CATCH_UP_CONFIRM_TRIES && waiting.length > 0; attempt++) {
      if (attempt > 0) {
        await this.deps.waitForGitHub();
      }
      let unread: Set<string>;
      try {
        unread = await this.deps.unreadOnGitHub();
      } catch (error) {
        this.deps.log(`inbox cleanup: could not read the inbox to check the bulk calls: ${errorText(error)}`);
        continue;
      }
      const left = waiting.filter((id) => unread.has(id));
      if (left.length < waiting.length) {
        this.advance(waiting.length - left.length);
      }
      waiting = left;
    }
    return waiting.length;
  }

  /**
   * The calls one after another: the older-than PUT, the repo PUTs, then a
   * PATCH per thread with a pause between them. No re-read before a PATCH:
   * the user picked these. A failed call is logged (GitHubWrites) and the
   * run goes on; writes turned off mid-run stop it. Threads a bulk PUT
   * covered count as marked only once the inbox shows them read.
   */
  private async run(plan: CleanupPlan, origin: 'cleanup' | 'footer', batch: string): Promise<void> {
    const { store, writes } = this.deps;
    const context = { origin, batch };
    let patched = 0;
    let failedCount = 0;
    let stopped = false;
    const bulk: { ids: string[]; send: () => Promise<'sent' | 'off'> }[] = [];
    const readBefore = plan.readBefore;
    if (readBefore !== null) {
      bulk.push({ ids: plan.readBeforeIds, send: () => writes.markAllReadBefore(readBefore, context) });
    }
    for (const { repo, ids } of plan.repos) {
      bulk.push({ ids, send: () => writes.markRepoReadBefore(repo, plan.at, context) });
    }
    const sentInBulk: string[] = [];
    for (const call of bulk) {
      try {
        if ((await call.send()) === 'off') {
          stopped = true;
          break;
        }
        sentInBulk.push(...call.ids);
      } catch {
        failedCount += call.ids.length;
        this.advance(call.ids.length);
      }
    }
    const threads = new Map(store.notifications.list().map((thread) => [thread.id, thread]));
    const markedKeys: PrKey[] = [];
    for (const [index, threadId] of plan.threadIds.entries()) {
      if (stopped) {
        break;
      }
      if (index > 0 || bulk.length > 0) {
        await this.deps.pause();
      }
      const thread = threads.get(threadId);
      const prKey = thread ? threadPrKey(thread) : null;
      try {
        if ((await writes.markThreadRead(threadId, { ...context, prKey })) === 'off') {
          stopped = true;
          break;
        }
        patched += 1;
        if (thread) {
          mirrorRead(store, thread, prKey);
          if (prKey !== null) {
            markedKeys.push(prKey);
          }
        }
      } catch {
        failedCount += 1;
      }
      this.advance(1);
    }
    advanceSeenFromGitHub(store, markedKeys, this.deps.now().toISOString());
    const stillOnGitHub = sentInBulk.length === 0 ? 0 : await this.confirmBulk(sentInBulk);
    this.finish({ batch, origin, marked: patched + sentInBulk.length - stillOnGitHub, failed: failedCount, stillOnGitHub, stopped });
  }

  private finish(run: { batch: string; origin: 'cleanup' | 'footer'; marked: number; failed: number; stillOnGitHub: number; stopped: boolean }): void {
    const parts = [`marked ${run.marked} read on GitHub`];
    if (run.stillOnGitHub > 0) {
      parts.push(`GitHub is still working on ${run.stillOnGitHub}`);
    }
    if (run.failed > 0) {
      parts.push(`${run.failed} failed`);
    }
    if (run.stopped) {
      parts.push('stopped: GitHub writes went off');
    }
    const detail = parts.join('; ');
    const outcome = run.marked === 0 && (run.failed > 0 || run.stopped) ? 'failed' : 'github';
    this.deps.writes.log.record({ action: 'inbox_cleanup', origin: run.origin, outcome, batch: run.batch, detail });
    this.deps.log(`inbox cleanup: ${detail}`);
    if (run.marked > 0) {
      this.deps.telemetry.capture('marked_read', { count: run.marked, origin: 'cleanup' });
    }
    this.lastRun = { id: run.batch, marked: run.marked, failed: run.failed, stillOnGitHub: run.stillOnGitHub, at: this.deps.now().toISOString() };
  }
}
