import type { PrKey, Timers } from '@postpile/core';
import type { Store } from '@postpile/store';
import type { Telemetry } from '../telemetry/telemetry.ts';
import type { GitHubWrites, WriteContext, WriteResult } from '../writes/github-writes.ts';
import type { PendingWrites } from '../writes/pending-writes.ts';
import { recordFollowed } from './followed.ts';

/** How long a Follow waits for GitHub (the PR lookup, the subscription); a quit or the lock's queue waits at most this long. */
export const FOLLOW_LOOKUP_MS = 10_000;

/** GitHub did not answer a Follow's lookup or subscription within FOLLOW_LOOKUP_MS; telemetry tells it from a failed request. */
export class FollowDeadlineError extends Error {
  constructor() {
    super(`no answer within ${FOLLOW_LOOKUP_MS / 1000} s`);
    this.name = 'FollowDeadlineError';
  }
}

/** `work`'s answer, or a rejection once FOLLOW_LOOKUP_MS passed without one: a stalled GitHub never holds a quit or the lock. */
export function withDeadline<T>(timers: Timers, work: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const deadline = timers.setTimeout(() => reject(new FollowDeadlineError()), FOLLOW_LOOKUP_MS);
    work.then(
      (value) => {
        timers.clearTimeout(deadline);
        resolve(value);
      },
      (error: unknown) => {
        timers.clearTimeout(deadline);
        reject(error);
      },
    );
  });
}

/**
 * The Follow subscription within the deadline, from the undo queue and the
 * lock's queue alike. Past the deadline it rejects (the caller parks the
 * Follow as failed); the request still runs, and when GitHub answers OK
 * after all, `onLateOk` runs. Telemetry hears of both, never the PR.
 */
export async function followWithDeadline(writes: GitHubWrites, timers: Timers, telemetry: Telemetry, subjectId: string, context: WriteContext, onLateOk: () => void): Promise<WriteResult> {
  const sending = writes.followPr(subjectId, context);
  try {
    return await withDeadline(timers, sending);
  } catch (error) {
    telemetry.capture('scout_follow_failed', { stage: error instanceof FollowDeadlineError ? 'timeout' : 'subscribe' });
    sending.then(
      (late) => {
        if (late !== 'off') {
          telemetry.capture('scout_follow_late_success', {});
          onLateOk();
        }
      },
      () => {},
    );
    throw error;
  }
}

/**
 * A Follow GitHub took after the deadline: followed after all, and its
 * parked write cleared. Never throws: the store may be closed by then, and
 * the parked write then sends again next start (subscribing twice is
 * harmless).
 */
export function recordLateFollow(store: Store, pendingWrites: PendingWrites, prKey: PrKey, batch: string, at: string): void {
  try {
    pendingWrites.clearFollow(prKey, batch);
    recordFollowed(store, prKey, at);
  } catch {
    // Quit meanwhile.
  }
}
