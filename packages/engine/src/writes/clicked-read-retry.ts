import {
  clickedReadCheck,
  clickedReadDetail,
  clickedReadNotice,
  clickedReadReason,
  prReadScope,
  type ClickedReadCheck,
  type KeptUnreadNotice,
  type NotificationThread,
  type PendingThread,
  type PrKey,
  type ThreadOutcome,
} from '@postpile/core';
import type { GitHubReader } from '@postpile/github';
import type { Store } from '@postpile/store';
import { readLocally } from '../actions/local-change.ts';
import { loadViewer } from '../viewer-meta.ts';
import type { GitHubWrites, WriteContext } from './github-writes.ts';
import { markThreadReadIfUnchanged } from './thread-mark-read.ts';

type KeepCheck = Extract<ClickedReadCheck, { kind: 'keep' }>;

const STALE: KeepCheck = { kind: 'keep', why: 'stale_snapshot' };

/** The click's mark-read was skipped for newer activity: fetch the PR again (a single-PR refresh), best effort. */
export type RefreshPr = (key: PrKey) => Promise<void>;

/**
 * A user's Mark read (tile, PR, detail, debug view, a pending send) that
 * GitHub skipped for activity after the last sync. Instead of popping the
 * tile back, the PR is fetched again and the click decided again
 * (`clickedReadCheck`): only the user's own activity and automation after
 * what the click showed, and it is marked read on GitHub now (guarded again
 * against the fresh updated_at); a person's activity, and it stays unread
 * with a notice that names it. DESIGN.md "GitHub writes: lock, action log"
 * › Newer activity after a click.
 *
 * While it decides, the thread is held: the inbox leaves its row alone
 * (GitHubSync), so the tile never turns unread in between. The retry writes
 * GitHub's row itself at the end. The caller (MarkReadQueue) puts the rest
 * of the click back when the outcome is `skipped` or `off`.
 */
export class ClickedReadRetry {
  private noticeCount = 0;
  private latest: KeptUnreadNotice | null = null;
  private decidedCount = 0;

  constructor(
    private readonly store: Store,
    private readonly reader: GitHubReader,
    private readonly writes: GitHubWrites,
    private readonly refresh: RefreshPr,
    private readonly heldThreads: Set<string>,
  ) {}

  /** The newest "kept unread" notice, for the renderer's toast; null before the first. */
  notice(): KeptUnreadNotice | null {
    return this.latest;
  }

  /** Grows with every retry that ended, so the renderer refetches what it left. */
  decided(): number {
    return this.decidedCount;
  }

  private log(thread: PendingThread, context: WriteContext, outcome: 'observed' | 'skipped', detail: string): void {
    this.writes.log.record({ action: 'mark_read', ...context, threadId: thread.id, outcome, detail });
  }

  /** Stays unread: GitHub's row as it is now, the log row and the notice. The caller puts the click's local change back. */
  private keep(thread: PendingThread, key: PrKey, current: NotificationThread, context: WriteContext, check: KeepCheck): ThreadOutcome {
    this.store.notifications.upsertMany([current]);
    this.log(thread, context, 'skipped', clickedReadDetail(check));
    this.noticeCount += 1;
    this.latest = { id: this.noticeCount, message: clickedReadNotice(check), prKey: key };
    return { kind: 'skipped', reason: clickedReadReason(check) };
  }

  /** The check over the PR as the refresh left it; null when the PR or the viewer is not stored. */
  private check(thread: PendingThread, key: PrKey, current: NotificationThread): ClickedReadCheck | null {
    const pr = this.store.prs.get(key);
    const viewer = loadViewer(this.store);
    if (!pr || !viewer) {
      return null;
    }
    return clickedReadCheck({
      thread: current,
      pr,
      events: this.store.events.listForPr(key),
      viewer,
      prFetchedAt: this.store.prs.fetchedAt(key),
      shownUpTo: thread.updatedAt,
    });
  }

  private async decide(thread: PendingThread, key: PrKey, context: WriteContext): Promise<ThreadOutcome> {
    await this.refresh(key);
    const current = await this.reader.getThread(thread.id);
    if (current === null || !current.unread) {
      // Read elsewhere meanwhile: GitHub's read time also covers what the refresh stored after the click.
      const readAt = current?.lastReadAt ?? thread.updatedAt;
      this.store.notifications.markRead(thread.id, readAt);
      readLocally(this.store, prReadScope(key, false), { kind: 'read_on_github', readAt }, readAt);
      this.log(thread, context, 'observed', 'already read on GitHub');
      return { kind: 'observed' };
    }
    const check = this.check(thread, key, current) ?? STALE;
    if (check.kind === 'keep') {
      return this.keep(thread, key, current, context, check);
    }
    const result = await markThreadReadIfUnchanged(this.reader, this.writes, current, { ...context, detail: clickedReadDetail(check) });
    if (result.kind === 'off') {
      return { kind: 'off' };
    }
    if (result.kind === 'moved') {
      return this.keep(thread, key, current, context, STALE);
    }
    const readAt = result.kind === 'sent' ? result.readAt : (result.lastReadAt ?? current.updatedAt);
    // GitHub's row, read, and what came after the click seen: the click meant all of it.
    this.store.notifications.upsertMany([{ ...current, unread: false, lastReadAt: readAt }]);
    readLocally(this.store, prReadScope(key, false), { kind: 'button' }, readAt);
    if (result.kind === 'already_read') {
      this.log(thread, context, 'observed', 'already read on GitHub');
      return { kind: 'observed' };
    }
    return { kind: 'sent' };
  }

  /** Decides a skipped PR thread again. Throws GitHubWrites' logged failure. */
  async afterNewerActivity(thread: PendingThread, key: PrKey, context: WriteContext): Promise<ThreadOutcome> {
    this.heldThreads.add(thread.id);
    try {
      return await this.decide(thread, key, context);
    } finally {
      this.heldThreads.delete(thread.id);
      this.decidedCount += 1;
    }
  }
}
