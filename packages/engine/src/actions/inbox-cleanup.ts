import {
  cleanupCutoff,
  cleanupLook,
  CLEANUP_SNOOZE_DAYS,
  isLongSyncGap,
  unreadOlderThan,
  type ActionResult,
  type CleanupAge,
  type InboxCleanupView,
  type IsoTime,
} from '@postpile/core';
import type { Store } from '@postpile/store';
import { errorText } from '../errors.ts';
import type { GitHubWrites } from '../writes/github-writes.ts';
import type { PendingWrites } from '../writes/pending-writes.ts';
import { failed, ok } from './results.ts';

const LAST_SYNC_KEY = 'last_sync_started_at';
const PROMINENT_KEY = 'inbox_cleanup_prominent';
const HIDDEN_UNTIL_KEY = 'inbox_cleanup_hidden_until';

/**
 * Called at the start of every full sync. The first sync on a store, or one
 * after CLEANUP_GAP_DAYS without a sync (vacation), makes the cleanup
 * prominent until the user picks something in the dialog. A store from
 * before this has no stored sync time; its newest PR fetch stands in.
 */
export function noteSyncStart(store: Store, at: IsoTime): void {
  const fetched = [...store.prs.fetchedAtByKey().values()].sort().at(-1) ?? null;
  const previous = store.meta.get(LAST_SYNC_KEY) ?? fetched;
  if (isLongSyncGap(previous, at)) {
    store.meta.set(PROMINENT_KEY, '1');
  }
  store.meta.set(LAST_SYNC_KEY, at);
}

/**
 * The inbox cleanup dialog: count old unread threads, mark them read on
 * GitHub in one call (through the writes door, so the lock turns it into a
 * pending write), or hide it for a week. The local-only "start fresh" is
 * gone (DESIGN.md "GitHub unread is PostPile unread"); migration 021 drops a
 * stored baseline.
 */
export class InboxCleanup {
  constructor(
    private readonly store: Store,
    private readonly writes: GitHubWrites,
    private readonly pendingWrites: PendingWrites,
    private readonly now: () => Date,
    /** Reads the inbox again after the PUT, so reconciliation makes the tiles follow. */
    private readonly reread: () => Promise<void>,
  ) {}

  view(): InboxCleanupView {
    const now = this.now().toISOString();
    const threads = this.store.notifications.list();
    const unreadOlderThan14 = unreadOlderThan(threads, cleanupCutoff(now, 14));
    const hiddenUntil = this.store.meta.get(HIDDEN_UNTIL_KEY);
    const prominent = this.store.meta.get(PROMINENT_KEY) !== null;
    return {
      unreadOlderThan14,
      unreadOlderThan30: unreadOlderThan(threads, cleanupCutoff(now, 30)),
      look: cleanupLook({ unreadOlderThan14, prominent, hiddenUntil }, now),
      hiddenUntil: hiddenUntil !== null && hiddenUntil > now ? hiddenUntil : null,
      pendingCutoff: this.pendingWrites.pendingCleanupCutoff(),
    };
  }

  /** Any choice in the dialog answers the prominent banner. */
  private answered(): void {
    this.store.meta.delete(PROMINENT_KEY);
  }

  /**
   * "Mark everything older than N days read on GitHub": one PUT
   * /notifications with last_read_at = the cutoff. Locked, it becomes one
   * pending write. GitHub may finish it in the background (202), so the
   * inbox is read again right away and the live poll and the next sync pick
   * up the rest.
   */
  async markReadBefore(age: CleanupAge): Promise<ActionResult> {
    const cutoff = cleanupCutoff(this.now().toISOString(), age);
    const batch = `cleanup:${this.now().getTime()}`;
    this.answered();
    if (!this.writes.enabled()) {
      this.pendingWrites.parkCleanup(cutoff, batch);
      return ok(`Pending: marks everything older than ${age} days read once you unlock and send it from the lock`);
    }
    try {
      await this.writes.markAllReadBefore(cutoff, { origin: 'cleanup', batch });
    } catch (error) {
      return failed(`GitHub didn't take the cleanup: ${errorText(error)}`);
    }
    await this.reread().catch(() => {});
    return ok(`Asked GitHub to mark everything older than ${age} days read. It can take a moment; the tiles follow on the next poll.`);
  }

  /** "Not now": hides the line and the banner for a week. */
  hide(): ActionResult {
    this.answered();
    const until = new Date(this.now().getTime() + CLEANUP_SNOOZE_DAYS * 24 * 60 * 60 * 1000);
    this.store.meta.set(HIDDEN_UNTIL_KEY, until.toISOString());
    return ok(`Hidden for ${CLEANUP_SNOOZE_DAYS} days`);
  }
}
