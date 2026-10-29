import { randomUUID } from 'node:crypto';
import { cleanDismissReason, DeferredQueue, isScoutedActive, parsePrKey, UNDO_WINDOW_MS, type ActionResult, type IsoTime, type PrKey, type ScoutFollowState, type Timers } from '@postpile/core';
import type { GitHubReader } from '@postpile/github';
import type { Store } from '@postpile/store';
import { failed, ok } from '../actions/results.ts';
import { errorText } from '../errors.ts';
import type { GitHubWrites } from '../writes/github-writes.ts';
import type { PendingWrites } from '../writes/pending-writes.ts';
import { recordFollowed } from './followed.ts';

/** Undo tokens of a Follow carry this, so Engine.undo knows where to send them. */
const FOLLOW_TOKEN_PREFIX = 'follow:';

interface QueuedFollow {
  prKey: PrKey;
  subjectId: string;
  origin: 'tile' | 'detail';
  batch: string;
  clickedAt: IsoTime;
  /** Writes were locked at the click: it parks after the window even if the lock opens inside it, like a mark-read. */
  lockedAtClick: boolean;
}

/**
 * What the user does with a scouted PR (DESIGN.md "Scouts"): Follow,
 * Dismiss, and the local seen state on open.
 *
 * Follow subscribes the viewer to the PR on GitHub (GraphQL
 * updateSubscription on its node id) through the same door as every
 * write: an undo window first, then the writes lock decides. Locked, it
 * waits as a pending write in the footer; a failed send waits there too.
 * The PR counts as followed only once GitHub took it.
 *
 * Dismiss and seen are local and never reach GitHub. Seen never sets
 * `handled_at`: a scouted PR has no thread, and a handled mark would leak
 * into the inbox rules once the PR reaches the inbox.
 */
/** How long Follow waits for the PR's node id; a quit's flush waits at most this long for a Follow still looking. */
export const FOLLOW_LOOKUP_MS = 10_000;

export class ScoutActions {
  private readonly queue: DeferredQueue<QueuedFollow>;
  /** Follows that left their window (followed, or parked in the lock): the live status counts them, so the renderer refetches. */
  private settledFollows = 0;
  /** PRs whose Follow is looking up the node id: reserved, so an overlapping Follow is refused. */
  private readonly lookingUp = new Set<PrKey>();
  /** Follows still running (looking up the PR): flush waits for them. */
  private readonly inFlight = new Set<Promise<ActionResult>>();

  constructor(
    private readonly store: Store,
    private readonly reader: GitHubReader,
    private readonly writes: GitHubWrites,
    private readonly pendingWrites: PendingWrites,
    private readonly timers: Timers,
    private readonly now: () => Date,
  ) {
    this.queue = new DeferredQueue((follow) => this.send(follow), timers, UNDO_WINDOW_MS, (error, batch) => {
      this.pendingWrites.parkFollow({ prKey: batch.payload.prKey, subjectId: batch.payload.subjectId }, { ...batch.payload, error: errorText(error) });
    });
  }

  /** After the undo window: to GitHub while writes are on, else into the lock's pending writes. */
  private async send(follow: QueuedFollow): Promise<void> {
    try {
      await this.sendNow(follow);
    } finally {
      this.settledFollows += 1;
    }
  }

  private async sendNow(follow: QueuedFollow): Promise<void> {
    const pending = { prKey: follow.prKey, subjectId: follow.subjectId };
    if (follow.lockedAtClick || !this.writes.enabled()) {
      this.pendingWrites.parkFollow(pending, { ...follow, error: null });
      return;
    }
    let result;
    try {
      result = await this.writes.followPr(follow.subjectId, { origin: 'queue', prKey: follow.prKey, batch: follow.batch });
    } catch (error) {
      this.pendingWrites.parkFollow(pending, { ...follow, error: errorText(error) });
      return;
    }
    if (result === 'off') {
      this.pendingWrites.parkFollow(pending, { ...follow, error: null });
      return;
    }
    recordFollowed(this.store, follow.prKey, this.now().toISOString());
  }

  /** Grows each time a Follow leaves its undo window. */
  changes(): number {
    return this.settledFollows;
  }

  /** Follows that have not reached GitHub yet, by PR: in their undo window (or being sent), else parked in the lock. */
  followStates(): Map<PrKey, ScoutFollowState> {
    const states = new Map<PrKey, ScoutFollowState>(this.pendingWrites.followStates());
    for (const follow of this.queue.unfinished()) {
      states.set(follow.prKey, 'queued');
    }
    return states;
  }

  /** The PR's node id, or a rejection once FOLLOW_LOOKUP_MS passed without an answer. */
  private lookUpNodeId(prKey: PrKey): Promise<string | null> {
    return new Promise((resolve, reject) => {
      const deadline = this.timers.setTimeout(() => reject(new Error(`no answer within ${FOLLOW_LOOKUP_MS / 1000} s`)), FOLLOW_LOOKUP_MS);
      this.reader.scoutPrNodeId(parsePrKey(prKey)).then(
        (id) => {
          this.timers.clearTimeout(deadline);
          resolve(id);
        },
        (error: unknown) => {
          this.timers.clearTimeout(deadline);
          reject(error);
        },
      );
    });
  }

  /**
   * Follow on a scouted PR. Tracked while it runs (its node id lookup can
   * take a while), so a quit's flush waits for it to queue before draining.
   */
  async follow(prKey: PrKey, origin: 'tile' | 'detail'): Promise<ActionResult> {
    const running = this.followNow(prKey, origin);
    this.inFlight.add(running);
    try {
      return await running;
    } finally {
      this.inFlight.delete(running);
    }
  }

  private async followNow(prKey: PrKey, origin: 'tile' | 'detail'): Promise<ActionResult> {
    // The lock as it was at the click, before the lookup below: an unlock while it runs must not send this Follow by itself.
    const lockedAtClick = !this.writes.enabled();
    const clickedAt = this.now().toISOString();
    const row = this.store.scoutedPrs.get(prKey);
    if (!row) {
      return failed('Not a PR a scout pulled in');
    }
    if (row.followedAt !== null) {
      return ok('Already followed');
    }
    if (this.followStates().has(prKey) || this.lookingUp.has(prKey)) {
      return ok('Follow already on its way');
    }
    // Reserved until the lookup settles: a second click meanwhile must not queue a second subscription.
    this.lookingUp.add(prKey);
    let subjectId: string | null = null;
    try {
      subjectId = await this.lookUpNodeId(prKey);
    } catch (error) {
      // Nothing queued, nothing sent; a quit's flush stops waiting here too.
      this.writes.log.record({ action: 'follow', origin, outcome: 'failed', prKey, detail: `PR lookup failed, nothing queued: ${errorText(error)}` });
      return failed(`Could not follow: GitHub did not answer (${errorText(error)}). Click Follow again to retry.`);
    } finally {
      this.lookingUp.delete(prKey);
    }
    if (subjectId === null) {
      return failed('GitHub has no such PR the token can see');
    }
    const follow: QueuedFollow = { prKey, subjectId, origin, batch: randomUUID(), clickedAt, lockedAtClick };
    const batch = this.queue.enqueue(follow);
    this.writes.log.record({ action: 'follow', origin, outcome: 'queued', prKey, batch: follow.batch, detail: follow.lockedAtClick ? 'turns pending when the window ends: GitHub writes are locked' : '' });
    const message = follow.lockedAtClick ? 'Following is pending until you unlock GitHub writes' : 'Following on GitHub in a few seconds';
    return ok(message, `${FOLLOW_TOKEN_PREFIX}${batch.token}`);
  }

  isUndo(token: string | null): boolean {
    return token !== null && token.startsWith(FOLLOW_TOKEN_PREFIX);
  }

  /** Takes a Follow back inside its window; nothing reached GitHub. */
  undo(token: string): ActionResult {
    const batch = this.queue.undo(token.slice(FOLLOW_TOKEN_PREFIX.length));
    if (batch === null) {
      return failed('undo window closed');
    }
    this.writes.log.record({ action: 'undo_follow', origin: batch.payload.origin, outcome: 'local', prKey: batch.payload.prKey, batch: batch.payload.batch, detail: 'undone in the window, nothing sent' });
    return ok('Follow undone');
  }

  /** Off the Scouted section for good, with an optional reason kept for tuning the scout later. Local only. */
  dismiss(prKey: PrKey, reason: string | null): ActionResult {
    const row = this.store.scoutedPrs.get(prKey);
    if (!row || !isScoutedActive(row)) {
      return failed('Not on the Scouted section');
    }
    this.store.scoutedPrs.dismiss(prKey, this.now().toISOString(), cleanDismissReason(reason));
    return ok('Dismissed');
  }

  /** Seen in PostPile through the PR's current update; never a GitHub read and never `handled_at`. */
  markSeen(prKey: PrKey): ActionResult {
    const pr = this.store.prs.get(prKey);
    if (!pr || !this.store.scoutedPrs.get(prKey)) {
      return failed('Not a PR a scout pulled in');
    }
    this.store.scoutedPrs.markSeen(prKey, pr.updatedAt);
    return ok('Seen');
  }

  /**
   * On quit: Follows still looking up their PR finish queuing first (at
   * most FOLLOW_LOOKUP_MS, after which one still waiting is dropped with a
   * log line, nothing queued), then those in their window go out now (or
   * into the lock), like the mark-read queue's flush.
   */
  async flush(): Promise<void> {
    await Promise.allSettled(this.inFlight);
    return this.queue.flush();
  }
}
