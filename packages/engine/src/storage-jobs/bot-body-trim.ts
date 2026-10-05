// Storage job 1: the one-time cut of bot bodies in stored snapshots
// (DESIGN.md "Bot bodies are cut when saved"). A fetch cuts them on the way
// in (normalize.ts), but most stored PRs are merged or closed and never
// fetched again, so this rewrites what is stored, once.
//
// Events are left as they are. The cut changes no event's id, kind or
// loudness (bodies a rule reads further stay whole), and a deploy event
// whose comment says "deploy" only past the cut moves to bot_comment the
// next time the PR's events are derived, keeping its state (EventRepo
// `upsertDerived`).
import { trimBotBodies } from '@postpile/core';
import type { Store } from '@postpile/store';
import type { StorageJob, StorageJobUnit } from './runner.ts';

/**
 * Set once every stored snapshot is cut (to when). The key 0.19.0 wrote
 * before the runner took the job over, so an install that finished it then
 * never runs it again.
 */
export const BOT_BODY_TRIM_DONE_KEY = 'bot_body_trim_done';

/** The key of the last stored PR the job got through. 0.19.0's key too, so an install mid-way resumes after it. */
export const BOT_BODY_TRIM_AFTER_KEY = 'bot_body_trim_after';

/**
 * Walks every stored PR once, in key order, and writes back the ones with
 * a bot body cut on save, with the same fetched_at (it still holds what
 * that fetch brought, only shorter).
 */
export class BotBodyTrimJob implements StorageJob {
  readonly name = 'bot_body_trim';
  readonly cursorKey = BOT_BODY_TRIM_AFTER_KEY;
  readonly doneKey = BOT_BODY_TRIM_DONE_KEY;

  /**
   * Reads the next stored PR after the cursor, in the runner's transaction,
   * so a snapshot a sync stored meanwhile is read fresh, never overwritten
   * with an older one. Writes only when the cut changed something.
   */
  step(store: Store, after: string): StorageJobUnit | null {
    const row = store.prs.nextAfter(after);
    if (row === null) {
      return null;
    }
    const trimmed = trimBotBodies(row.pr);
    if (trimmed === row.pr) {
      return { key: row.key, wrote: false };
    }
    store.prs.upsert(trimmed, row.fetchedAt);
    return { key: row.key, wrote: true };
  }

  /**
   * The walk is its own check: it went through every stored PR after the
   * cursor, and every PR stored behind the cursor meanwhile came from a
   * fetch, which cuts on save, or a local rewrite of a PR already cut.
   */
  complete(): 'done' {
    return 'done';
  }
}
