// Background rewrites of stored data (DESIGN.md "Storage jobs"). JS work
// like parsing and cutting snapshots, or later moving them into rows, runs
// on Electron's main thread, so it never goes into a numbered migration:
// a job walks the store in small units, a slice of units per transaction,
// with pauses between slices and none while foreground work runs. One job
// at a time, in order, each resuming where a quit left it.
import type { IsoTime, StorageJobName, Timers } from '@postpile/core';
import { isBusyError, type Store } from '@postpile/store';
import { errorText } from '../errors.ts';

/** Wait after start: the window, its first board and the start sync come first. */
export const START_DELAY_MS = 30_000;

/**
 * Soft budget of one slice, its commit included: units run until it is
 * spent, with the expected commit time set aside, at least one. A unit is
 * never cut short, so one big PR (a snapshot of several MB) can go over it.
 */
export const SLICE_BUDGET_MS = 30;

/** Rest between two slices, so the main thread answers the window in between (a job takes at most ~38% of it). */
export const PAUSE_MS = 50;

/** How often to look again while foreground work runs, or another connection holds the write lock. */
export const RETRY_MS = 2_000;

/** After the Mac wakes: the wake burst (live poll, the window catching up) comes first. */
export const WAKE_DELAY_MS = 30_000;

/** How long a slice waits for the write lock: not at all. It tries again after RETRY_MS instead of blocking the main thread. */
const LOCK_WAIT_MS = 0;

/** Meta key prefix of a job left incomplete (its check failed after walking it twice), set to when. */
export const INCOMPLETE_KEY_PREFIX = 'storage_job_incomplete:';

/** One unit a job got through: its key, the new cursor, and whether it wrote anything. */
export interface StorageJobUnit {
  key: string;
  wrote: boolean;
}

/** One background rewrite of stored data, done in small units that resume after a quit. */
export interface StorageJob {
  /** Stable and never reused: log lines, telemetry and the incomplete flag name it. */
  readonly name: StorageJobName;
  /** Meta key of the cursor: the key of the last unit done, so a quit resumes after it. Never reused. */
  readonly cursorKey: string;
  /** Meta key set (to when) once the job walked to the end and its check passed: it never runs again. Never reused. */
  readonly doneKey: string;
  /**
   * The next unit after `after` ('' at the start), inside the runner's
   * BEGIN IMMEDIATE transaction: read what it rewrites, change it with pure
   * code, write it back. Any SQL or repository write goes, as long as it
   * stays inside that transaction (no transaction of its own). A PR's
   * revision moves (the store-wide counter, `PrRepo.upsert`) only when
   * what a read of that PR returns changes, like the trim's cut; a
   * backfill into rows that reads don't use yet, or a strip of what they
   * no longer read, leaves it alone. Returns null when nothing is left.
   */
  step(store: Store, after: string): StorageJobUnit | null;
  /**
   * In the transaction that found nothing left: checks from the data that
   * the job is complete and, only then, switches what depends on it
   * (readiness flags, set to `at`). Only 'done' marks it done. 'again'
   * walks it once more from the start and must leave every switch unset,
   * since it commits; a second 'again' leaves it incomplete, and the jobs
   * after it wait.
   */
  complete(store: Store, at: IsoTime): 'done' | 'again';
  /**
   * For a job whose check can fail: how many units it still finds undone,
   * in the transaction that left it incomplete (telemetry
   * storage_job_blocked). Counts only.
   */
  blockedUnits?(store: Store): number;
  /**
   * After the transaction that marked it done committed, outside any
   * transaction: work SQLite cannot do inside one, like snapshot_strip's
   * WAL checkpoint. Must not throw.
   */
  afterDone?(store: Store): void;
}

/** What a finished job did in this run (a job resumed after a quit counts only what was left). */
export interface StorageJobReport {
  name: StorageJobName;
  units: number;
  /** Of the units, the ones that wrote. */
  wrote: number;
  /** Main-thread time in its slices, commits included. */
  workMs: number;
  longestSliceMs: number;
  /** From its first slice to the end, pauses and waits included. */
  wallMs: number;
}

export interface StorageJobRunnerDeps {
  store: Store;
  /** In order: a job starts once every job before it is done. */
  jobs: StorageJob[];
  now: () => Date;
  timers: Timers;
  /** Foreground work runs (a sync, a poll cycle, a consolidation, a catch-up): no slice starts until it ends. */
  busy: () => boolean;
  log: (line: string) => void;
  /** A job finished and its check passed (telemetry storage_job_done). */
  onDone: (report: StorageJobReport) => void;
  /**
   * A job ended its walk incomplete (its check failed twice), with the
   * units its check still finds undone: telemetry storage_job_blocked. At
   * most once per job per runner, so once per app run.
   */
  onBlocked?: (blocked: StorageJobBlocked) => void;
  /** Tests pass 0: one unit per slice. */
  sliceBudgetMs?: number;
}

/** A job left incomplete, and how many units its check still finds undone (null: the job does not say). */
export interface StorageJobBlocked {
  name: StorageJobName;
  blockedUnits: number | null;
}

/**
 * What one slice did: ran units, found every job done, found the write
 * lock taken by another connection (nothing ran), or left its job
 * incomplete.
 */
export type SliceOutcome = 'worked' | 'idle' | 'locked' | 'incomplete';

/** How a slice's transaction ended: the cursor moved, the job is done, it walks again, or it is incomplete. */
type SliceEnd = 'more' | 'done' | 'again' | 'incomplete';

interface SliceWork {
  units: number;
  wrote: number;
  end: SliceEnd;
  /** When the end is 'incomplete': the units its check still finds undone, read in the same transaction. */
  blockedUnits?: number | null;
}

interface Progress {
  name: StorageJobName;
  units: number;
  wrote: number;
  workMs: number;
  longestSliceMs: number;
  firstSliceAt: number;
}

function incompleteKey(job: StorageJob): string {
  return `${INCOMPLETE_KEY_PREFIX}${job.name}`;
}

/**
 * Runs the storage jobs in the background, one slice at a time. Each slice
 * is one BEGIN IMMEDIATE transaction: the units' writes, the cursor and the
 * done flag commit together or not at all, so a crash or a failing unit
 * leaves the cursor at the last slice that committed.
 */
export class StorageJobRunner {
  private timer: unknown = null;
  /** start() was called and nothing ended it since: stop(), a failure, an incomplete job, or every job done. */
  private running = false;
  private suspended = false;
  /** Jobs that took their one more walk in this run. */
  private readonly walkedAgain = new Set<StorageJobName>();
  /** Jobs whose being blocked was reported (onBlocked): never twice for the life of the runner. */
  private readonly reportedBlocked = new Set<StorageJobName>();
  /** This run's numbers for the job under way. */
  private progress: Progress | null = null;
  /**
   * What a commit takes, averaged over the last few slices: writing the
   * WAL, and every few commits SQLite's automatic checkpoint into the
   * database file (one in two slices on the copies measured, ~15 ms). A
   * slice stops its units this much early, so slice and commit together
   * stay near the budget.
   */
  private commitMs = 0;

  constructor(private readonly deps: StorageJobRunnerDeps) {}

  /** The first job not done yet, or null when all are. */
  private currentJob(): StorageJob | null {
    return this.deps.jobs.find((job) => this.deps.store.meta.get(job.doneKey) === null) ?? null;
  }

  /**
   * Nothing is left after the cursor: the job is done only if its check
   * passes (fail closed). A failed check walks it once more from the start;
   * failing again leaves it incomplete, flagged in meta and never done.
   */
  private complete(job: StorageJob): SliceEnd {
    const { store } = this.deps;
    const at = this.deps.now().toISOString();
    store.meta.delete(job.cursorKey);
    if (job.complete(store, at) === 'done') {
      store.meta.set(job.doneKey, at);
      store.meta.delete(incompleteKey(job));
      return 'done';
    }
    if (!this.walkedAgain.has(job.name)) {
      return 'again';
    }
    store.meta.set(incompleteKey(job), at);
    return 'incomplete';
  }

  /**
   * Units until the budget is spent, the expected commit included, then the
   * cursor, all in the caller's transaction; or the check once nothing is
   * left.
   */
  private runUnits(job: StorageJob, started: number): SliceWork {
    const { store, timers } = this.deps;
    const budget = this.deps.sliceBudgetMs ?? SLICE_BUDGET_MS;
    let after = store.meta.get(job.cursorKey) ?? '';
    let units = 0;
    let wrote = 0;
    do {
      const unit = job.step(store, after);
      if (unit === null) {
        const end = this.complete(job);
        return end === 'incomplete' ? { units, wrote, end, blockedUnits: job.blockedUnits?.(store) ?? null } : { units, wrote, end };
      }
      units += 1;
      wrote += unit.wrote ? 1 : 0;
      after = unit.key;
    } while (timers.now() - started + this.commitMs < budget);
    store.meta.set(job.cursorKey, after);
    return { units, wrote, end: 'more' };
  }

  private noteSlice(job: StorageJob, started: number, work: SliceWork): Progress {
    const sliceMs = this.deps.timers.now() - started;
    if (this.progress?.name !== job.name) {
      this.progress = { name: job.name, units: 0, wrote: 0, workMs: 0, longestSliceMs: 0, firstSliceAt: started };
    }
    this.progress.units += work.units;
    this.progress.wrote += work.wrote;
    this.progress.workMs += sliceMs;
    this.progress.longestSliceMs = Math.max(this.progress.longestSliceMs, sliceMs);
    return this.progress;
  }

  private finish(progress: Progress): void {
    const report: StorageJobReport = {
      name: progress.name,
      units: progress.units,
      wrote: progress.wrote,
      workMs: progress.workMs,
      longestSliceMs: progress.longestSliceMs,
      wallMs: this.deps.timers.now() - progress.firstSliceAt,
    };
    this.progress = null;
    this.deps.log(
      `storage job ${report.name} done: ${report.wrote} of ${report.units} units rewritten, work ${report.workMs} ms, longest slice ${report.longestSliceMs} ms, wall ${report.wallMs} ms`,
    );
    this.deps.onDone(report);
  }

  private reportBlocked(name: StorageJobName, blockedUnits: number | null): void {
    if (this.reportedBlocked.has(name)) {
      return;
    }
    this.reportedBlocked.add(name);
    this.deps.onBlocked?.({ name, blockedUnits });
  }

  /** One slice of this job. Throws what the job threw, after the rollback. */
  private runSlice(job: StorageJob): SliceOutcome {
    const { store, timers } = this.deps;
    const started = timers.now();
    let unitsEnded = started;
    let work: SliceWork;
    try {
      work = store.immediateTransaction(LOCK_WAIT_MS, () => {
        const done = this.runUnits(job, started);
        unitsEnded = timers.now();
        return done;
      });
    } catch (error) {
      if (isBusyError(error)) {
        return 'locked';
      }
      throw error;
    }
    this.commitMs = (this.commitMs + timers.now() - unitsEnded) / 2;
    // No checkpoint of the runner's own at the end: one call could copy and sync a WAL that grew while a
    // reader held checkpoints back. SQLite's automatic checkpoint and journal_size_limit keep it small.
    // A job that rewrote most of the file may ask for one (afterDone); its time counts as the slice's.
    if (work.end === 'done') {
      job.afterDone?.(store);
    }
    const progress = this.noteSlice(job, started, work);
    if (work.end === 'done') {
      this.finish(progress);
    } else if (work.end === 'again') {
      this.walkedAgain.add(job.name);
      this.deps.log(`storage job ${job.name}: its check failed at the end, walking it once more`);
    } else if (work.end === 'incomplete') {
      const blocked = work.blockedUnits ?? null;
      this.deps.log(
        `storage job ${job.name} is incomplete: its check failed again after a second walk${blocked === null ? '' : `, ${blocked} units left undone`}. Not marked done, the jobs after it wait; the next start tries again.`,
      );
      this.reportBlocked(job.name, blocked);
      return 'incomplete';
    }
    return 'worked';
  }

  private schedule(ms: number): void {
    this.timer = this.deps.timers.setTimeout(() => this.tick(), ms);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      this.deps.timers.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private tick(): void {
    this.timer = null;
    if (this.deps.busy()) {
      this.schedule(RETRY_MS);
      return;
    }
    let job: StorageJob | null = null;
    let outcome: SliceOutcome;
    try {
      job = this.currentJob();
      outcome = job === null ? 'idle' : this.runSlice(job);
    } catch (error) {
      this.running = false;
      this.deps.log(`storage job ${job?.name ?? '(none)'} failed, the next start goes on after its last slice: ${errorText(error)}`);
      return;
    }
    if (outcome === 'worked') {
      this.schedule(PAUSE_MS);
    } else if (outcome === 'locked') {
      this.schedule(RETRY_MS);
    } else {
      this.running = false;
    }
  }

  /** Starts the jobs in the background after `delayMs`, unless every job is done or they run already. */
  start(delayMs = START_DELAY_MS): void {
    if (this.running || this.currentJob() === null) {
      return;
    }
    this.running = true;
    // A new run: every job gets its one more walk again, and its numbers start over.
    this.walkedAgain.clear();
    this.progress = null;
    if (!this.suspended) {
      this.schedule(delayMs);
    }
  }

  /** No further slice. Slices are synchronous, so none is half done; the next start resumes from the cursor. */
  stop(): void {
    this.running = false;
    this.clearTimer();
  }

  /** The Mac goes to sleep: no slice until resume(). */
  suspend(): void {
    this.suspended = true;
    this.clearTimer();
  }

  /** The Mac woke: the jobs go on after WAKE_DELAY_MS, if they were running. */
  resume(): void {
    this.suspended = false;
    if (this.running && this.timer === null) {
      this.schedule(WAKE_DELAY_MS);
    }
  }

  /** One slice now, synchronously (tests; a CLI check on copies later). Throws what the job threw. */
  slice(): SliceOutcome {
    const job = this.currentJob();
    return job === null ? 'idle' : this.runSlice(job);
  }
}
