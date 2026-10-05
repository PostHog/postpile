import type { IsoTime, Timers } from '@postpile/core';
import { errorText } from './errors.ts';

/** Minutes between background full syncs, unless POSTPILE_AUTO_SYNC_MINUTES says otherwise. */
export const DEFAULT_AUTO_SYNC_MINUTES = 60;

/**
 * Minutes to the next background sync when the last one stopped at the PR
 * cap (SYNC_MAX_PRS): a backlog, e.g. after two weeks away, drains in
 * batches a few minutes apart instead of one batch an hour.
 */
export const BACKLOG_SYNC_MINUTES = 2;

/**
 * Minutes a background sync waits at least after the Mac woke from sleep.
 * Right after a wake the live poll, glance catch-ups and the window's
 * refetches already run; the full sync, the heaviest thing PostPile does,
 * comes after them (DESIGN.md "Memory on big boards").
 */
export const WAKE_SYNC_DELAY_MINUTES = 3;

export interface AutoSyncOptions {
  /** 0 or less keeps it off. */
  minutes: number;
  /** The app's sync call cap, like "Sync now". */
  maxAgentCalls: number;
}

export interface AutoSyncTarget {
  isSyncing(): boolean;
  /** Epoch ms until which background GitHub work waits (the GitHub quota is low), else null. */
  pausedUntil(): number | null;
  sync(maxAgentCalls: number): Promise<unknown>;
}

/**
 * A background full sync every N minutes while the desktop app runs. The
 * interval counts from the end of the last sync, whoever started it (the
 * engine calls reschedule() when any sync ends), so a "Sync now" pushes the
 * next auto sync out. Skipped when a sync is running at the due time; that
 * sync's end schedules the next one. While the GitHub quota is low it waits
 * for the reset (DESIGN.md "GitHub quota"). Failures are logged, never thrown.
 */
export class AutoSyncSchedule {
  private timer: unknown = null;
  private dueAt: number | null = null;
  private started = false;
  /** Between suspend() and wake(): due times are kept, but no timer runs. */
  private suspended = false;

  constructor(
    private readonly target: AutoSyncTarget,
    private readonly timers: Timers,
    private readonly options: AutoSyncOptions,
    private readonly log: (line: string) => void,
  ) {}

  private clearTimer(): void {
    if (this.timer !== null) {
      this.timers.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private schedule(minutes: number = this.options.minutes): void {
    this.scheduleIn(minutes * 60 * 1000);
  }

  private scheduleIn(ms: number): void {
    this.clearTimer();
    this.dueAt = this.timers.now() + ms;
    if (this.suspended) {
      return;
    }
    this.timer = this.timers.setTimeout(() => {
      this.timer = null;
      void this.fire();
    }, ms);
  }

  private async fire(): Promise<void> {
    if (this.target.isSyncing()) {
      this.log('auto sync: skipped, a sync is running');
      return;
    }
    const pausedUntil = this.target.pausedUntil();
    if (pausedUntil !== null) {
      this.log(`auto sync: GitHub quota low, waiting until ${new Date(pausedUntil).toISOString()}`);
      this.scheduleIn(Math.max(0, pausedUntil - this.timers.now()));
      return;
    }
    this.log(`auto sync: starting (every ${this.options.minutes} min)`);
    try {
      await this.target.sync(this.options.maxAgentCalls);
    } catch (error) {
      this.log(`auto sync: failed: ${errorText(error)}`);
    }
    // The engine reschedules on every sync end; this covers a target that does not.
    if (this.started && this.timer === null) {
      this.schedule();
    }
  }

  start(): void {
    if (this.started || this.options.minutes <= 0) {
      return;
    }
    this.started = true;
    this.schedule();
  }

  stop(): void {
    this.started = false;
    this.suspended = false;
    this.clearTimer();
    this.dueAt = null;
  }

  /**
   * Any sync ended: the next auto sync is a full interval from now, or
   * BACKLOG_SYNC_MINUTES when that sync left PRs over (`backlog`).
   */
  reschedule(backlog = false): void {
    if (this.started) {
      this.schedule(backlog ? Math.min(BACKLOG_SYNC_MINUTES, this.options.minutes) : this.options.minutes);
    }
  }

  nextSyncAt(): IsoTime | null {
    return this.dueAt === null ? null : new Date(this.dueAt).toISOString();
  }

  /**
   * The Mac goes to sleep: the timer is cleared and the due time kept until
   * wake(). Otherwise a due time that passes during sleep could fire right
   * as the Mac wakes, before wake() is called, and start the full sync in
   * the wake burst. A sync that ends meanwhile still sets the next due time.
   */
  suspend(): void {
    if (!this.started) {
      return;
    }
    this.suspended = true;
    this.clearTimer();
  }

  /**
   * The Mac woke from sleep. Whether a timer counted the sleep depends on
   * the clock under it, so the next sync is set again from the kept due time
   * on the wall clock, but never sooner than WAKE_SYNC_DELAY_MINUTES from
   * now: an overdue sync waits those minutes instead of joining the wake
   * burst. Also works without a suspend() first. Nothing while off, or when
   * the auto sync itself runs and no suspend() came (its end sets the next one).
   */
  wake(): void {
    if (!this.started || (!this.suspended && this.timer === null)) {
      return;
    }
    this.suspended = false;
    if (this.dueAt === null) {
      return;
    }
    const minimumMs = WAKE_SYNC_DELAY_MINUTES * 60 * 1000;
    this.scheduleIn(Math.max(minimumMs, this.dueAt - this.timers.now()));
    this.log(`auto sync: woke from sleep, next one at ${this.nextSyncAt()}`);
  }
}
