// The one-time cut of bot bodies in stored snapshots (DESIGN.md "Bot bodies
// are cut when saved"). A fetch cuts them on the way in (normalize.ts), but
// most stored PRs are merged or closed and never fetched again, so this
// rewrites what is stored, once. It is JS work (parse, cut, stringify) on
// Electron's main thread, so no numbered migration: small timed steps in
// the background, with pauses between them and none while a sync, a poll,
// a consolidation or a catch-up runs.
//
// Events are left as they are. The cut changes no event's id, kind or
// loudness (bodies a rule reads further stay whole), and a deploy event
// whose comment says "deploy" only past the cut moves to bot_comment the
// next time the PR's events are derived, keeping its state (EventRepo
// `upsertDerived`).
import { trimBotBodies, type Timers } from '@postpile/core';
import type { Store } from '@postpile/store';
import { errorText } from './errors.ts';

/** Set once every stored snapshot is cut (to when): the job never runs again. */
export const BOT_BODY_TRIM_DONE_KEY = 'bot_body_trim_done';

/** The key of the last stored PR the job got through, so a quit mid-way resumes after it. */
export const BOT_BODY_TRIM_AFTER_KEY = 'bot_body_trim_after';

/** Wait after start: the window, its first board and the start sync come first. */
const START_DELAY_MS = 30_000;

/**
 * Soft budget of one step: PRs are read, cut and written until it is
 * spent, at least one. A snapshot of a few MB alone can take longer.
 */
const STEP_BUDGET_MS = 30;

/** Rest between two steps, so the main thread answers the window in between. */
const STEP_PAUSE_MS = 20;

/** How often to look again while foreground work runs. */
const BUSY_RETRY_MS = 2_000;

export interface BotBodyTrimDeps {
  store: Store;
  now: () => Date;
  timers: Timers;
  /** Foreground work runs (a sync, a poll cycle, a consolidation, a catch-up): the job waits for it to end. */
  busy: () => boolean;
  log: (line: string) => void;
  /** Tests pass 0: one PR per step. */
  stepBudgetMs?: number;
}

/**
 * Walks every stored PR once, in key order, and writes back the ones with
 * a bot body cut on save, with the same fetched_at (it still holds what
 * that fetch brought, only shorter). Resumes after the last finished step.
 */
export class BotBodyTrim {
  private timer: unknown = null;
  private prs = 0;
  private cut = 0;
  private startedAt = 0;

  constructor(private readonly deps: BotBodyTrimDeps) {}

  isDone(): boolean {
    return this.deps.store.meta.get(BOT_BODY_TRIM_DONE_KEY) !== null;
  }

  /**
   * One step, in one transaction: reads the next stored PR after the
   * cursor, cuts it, writes it back when something changed, and goes on
   * until the budget is spent. Reading and writing in the same transaction
   * means a snapshot a sync stored meanwhile is read fresh, never
   * overwritten with an older one. The cursor moves past the PRs done.
   * Marks the job done once none are left, and returns false then.
   */
  step(): boolean {
    const { store, timers } = this.deps;
    const budget = this.deps.stepBudgetMs ?? STEP_BUDGET_MS;
    const started = timers.now();
    return store.transaction(() => {
      let after = store.meta.get(BOT_BODY_TRIM_AFTER_KEY) ?? '';
      do {
        const row = store.prs.nextAfter(after);
        if (row === null) {
          store.meta.set(BOT_BODY_TRIM_DONE_KEY, this.deps.now().toISOString());
          store.meta.delete(BOT_BODY_TRIM_AFTER_KEY);
          return false;
        }
        this.prs += 1;
        const trimmed = trimBotBodies(row.pr);
        if (trimmed !== row.pr) {
          this.cut += 1;
          store.prs.upsert(trimmed, row.fetchedAt);
        }
        after = row.key;
      } while (timers.now() - started < budget);
      store.meta.set(BOT_BODY_TRIM_AFTER_KEY, after);
      return true;
    });
  }

  private schedule(ms: number): void {
    this.timer = this.deps.timers.setTimeout(() => this.tick(), ms);
  }

  private finish(): void {
    // The steps' commits leave the WAL as big as the biggest one; empty it now if nobody reads.
    const emptied = this.deps.store.checkpointWal();
    this.deps.log(
      `bot body trim: cut ${this.cut} of ${this.prs} stored PRs in ${this.deps.timers.now() - this.startedAt} ms${emptied ? '' : ', WAL not emptied (another connection was busy)'}`,
    );
  }

  private tick(): void {
    this.timer = null;
    if (this.deps.busy()) {
      this.schedule(BUSY_RETRY_MS);
      return;
    }
    try {
      if (this.step()) {
        this.schedule(STEP_PAUSE_MS);
      } else {
        this.finish();
      }
    } catch (error) {
      this.deps.log(`bot body trim failed, the next start goes on from the last step: ${errorText(error)}`);
    }
  }

  /** Starts the job in the background after START_DELAY_MS, unless it ran to the end before or is on its way. */
  start(delayMs = START_DELAY_MS): void {
    if (this.timer !== null || this.isDone()) {
      return;
    }
    this.startedAt = this.deps.timers.now();
    this.schedule(delayMs);
  }

  /** No further step runs. Steps are synchronous, so none is half done. */
  stop(): void {
    if (this.timer !== null) {
      this.deps.timers.clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
