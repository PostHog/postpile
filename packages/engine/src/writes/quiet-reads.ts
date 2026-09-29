import {
  eventsReadOnGitHub,
  quietReadCheck,
  quietReadDetail,
  QUIET_READS_PER_RUN,
  type NotificationThread,
  type PrKey,
} from '@postpile/core';
import type { GitHubReader } from '@postpile/github';
import type { Store } from '@postpile/store';
import { Board } from '../board.ts';
import { errorText } from '../errors.ts';
import { advanceSeenFromGitHub } from '../memory/seen-from-github.ts';
import type { GitHubWrites } from './github-writes.ts';

/** A thread that passed the rules, with the bots that made it unread. */
interface QuietCandidate {
  thread: NotificationThread;
  prKey: PrKey;
  bots: string[];
}

export interface QuietReadsResult {
  /** Threads marked read on GitHub. */
  marked: PrKey[];
  errors: string[];
}

const NOTHING_DONE: QuietReadsResult = { marked: [], errors: [] };

/**
 * "Handled quietly" (DESIGN.md): after a full sync, PR threads the user had
 * read that turned unread only because of bots get marked read on GitHub,
 * when nothing is asked of the user (`quietReadCheck`). Only while GitHub
 * writes are unlocked: locked, nothing happens and nothing piles up as a
 * pending write. Each thread is read again right before the write and left
 * alone when it moved since the sync. Every write goes through
 * GitHubWrites and is logged with origin `quiet`.
 */
export class QuietReads {
  constructor(
    private readonly store: Store,
    private readonly reader: GitHubReader,
    private readonly writes: GitHubWrites,
    private readonly now: () => Date,
  ) {}

  /** PRs whose tile is unread right now, any PR of the tile counts. */
  private unreadKeys(board: Board): Set<PrKey> {
    const keys = new Set<PrKey>();
    for (const tile of board.allTiles()) {
      if (board.stateOf(tile).kind === 'unread') {
        for (const member of tile.members) {
          keys.add(member.prKey);
        }
      }
    }
    return keys;
  }

  private candidates(board: Board): QuietCandidate[] {
    const viewer = board.viewer;
    if (viewer === null) {
      return [];
    }
    const unread = this.unreadKeys(board);
    const fetchedAt = this.store.prs.fetchedAtByKey();
    const result: QuietCandidate[] = [];
    for (const [prKey, thread] of board.threads) {
      const pr = board.prs.get(prKey);
      if (!pr) {
        continue;
      }
      const check = quietReadCheck({
        thread,
        pr,
        events: board.events.get(prKey) ?? [],
        userState: board.userStates.get(prKey) ?? null,
        viewer,
        tileUnread: unread.has(prKey),
        notYours: board.notYours.has(prKey),
        prFetchedAt: fetchedAt.get(prKey) ?? null,
        now: board.now,
      });
      if (check.kind === 'mark') {
        result.push({ thread, prKey, bots: check.bots });
      }
    }
    return result.slice(0, QUIET_READS_PER_RUN);
  }

  /** True when GitHub took the mark-read. Read elsewhere or moved since the sync: left for the next run. */
  private async markOne(candidate: QuietCandidate): Promise<boolean> {
    const current = await this.reader.getThread(candidate.thread.id);
    if (current === null || !current.unread || current.updatedAt > candidate.thread.updatedAt) {
      return false;
    }
    const detail = quietReadDetail(candidate.bots);
    const result = await this.writes.markThreadRead(candidate.thread.id, { origin: 'quiet', prKey: candidate.prKey, detail });
    if (result === 'off') {
      return false;
    }
    // Mirror GitHub: the thread is read up to its last update, and so are the bot events before it.
    this.store.notifications.markRead(candidate.thread.id, current.updatedAt);
    const events = this.store.events.listForPr(candidate.prKey);
    this.store.events.markSeen(eventsReadOnGitHub(events, current.updatedAt), current.updatedAt);
    return true;
  }

  async run(): Promise<QuietReadsResult> {
    if (!this.writes.enabled()) {
      return NOTHING_DONE;
    }
    const nowIso = this.now().toISOString();
    const result: QuietReadsResult = { marked: [], errors: [] };
    for (const candidate of this.candidates(Board.load(this.store, nowIso))) {
      try {
        if (await this.markOne(candidate)) {
          result.marked.push(candidate.prKey);
        }
      } catch (error) {
        // GitHubWrites logged it as failed; the thread stays unread and the next sync tries again.
        result.errors.push(`quiet mark-read of ${candidate.prKey}: ${errorText(error)}`);
      }
    }
    advanceSeenFromGitHub(this.store, result.marked, nowIso);
    return result;
  }
}
