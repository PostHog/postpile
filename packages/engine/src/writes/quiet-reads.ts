import {
  eventsReadOnGitHub,
  openedReadCheck,
  quietReadCheck,
  quietReadDetail,
  quietReasonDetail,
  QUIET_READS_PER_RUN,
  tileAfterMarkRead,
  touchedReadCheck,
  type NotificationThread,
  type OpenedTile,
  type PrKey,
  type QuietReadInput,
} from '@postpile/core';
import type { GitHubReader } from '@postpile/github';
import type { Store } from '@postpile/store';
import { Board } from '../board.ts';
import { errorText } from '../errors.ts';
import { advanceSeenFromGitHub } from '../memory/seen-from-github.ts';
import type { GitHubWrites } from './github-writes.ts';

/** A thread that passed the rules, with the action log detail that says why. */
interface QuietCandidate {
  thread: NotificationThread;
  prKey: PrKey;
  detail: string;
}

export interface QuietReadsResult {
  /** Threads marked read on GitHub. */
  marked: PrKey[];
  errors: string[];
}

const NOTHING_DONE: QuietReadsResult = { marked: [], errors: [] };

/** The log detail when a thread may be marked read: only bots since the last read, else the user acted after it. */
function quietDetail(input: QuietReadInput): string | null {
  const bots = quietReadCheck(input);
  if (bots.kind === 'mark') {
    return quietReadDetail(bots.bots);
  }
  const touched = touchedReadCheck(input);
  if (touched.kind === 'mark') {
    return quietReasonDetail(touched.reason);
  }
  return null;
}

/**
 * "Handled quietly" (DESIGN.md): after a full sync, PR threads the user had
 * read that turned unread only because of bots get marked read on GitHub,
 * when nothing is asked of the user (`quietReadCheck`), and so do threads
 * whose unread events all came before the user's own review or comment
 * (`touchedReadCheck`, "You already dealt with it"). Only while GitHub
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
      const detail = quietDetail({
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
      if (detail !== null) {
        result.push({ thread, prKey, detail });
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
    const result = await this.writes.markThreadRead(candidate.thread.id, { origin: 'quiet', prKey: candidate.prKey, detail: candidate.detail });
    if (result === 'off') {
      return false;
    }
    // Mirror GitHub: the thread is read up to its last update, and so are the events before it.
    this.store.notifications.markRead(candidate.thread.id, current.updatedAt);
    const events = this.store.events.listForPr(candidate.prKey);
    this.store.events.markSeen(eventsReadOnGitHub(events, current.updatedAt), current.updatedAt);
    return true;
  }

  /** Every tile that holds the PR: snoozed, and done after a mark-read (the rules behind `TileView.afterRead`). */
  private tilesHolding(board: Board, prKey: PrKey): OpenedTile[] {
    return board
      .allTiles()
      .filter((tile) => tile.members.some((member) => member.prKey === prKey))
      .map((tile) => ({
        snoozed: board.stateOf(tile).kind === 'snoozed',
        doneAfterRead: tileAfterMarkRead({
          tile,
          prs: board.prs,
          events: board.events,
          userStates: board.userStates,
          viewer: board.viewer,
          notYours: board.notYours,
          readAt: board.now,
        }).done,
      }));
  }

  /**
   * "Opened in PostPile" (DESIGN.md "You already dealt with it"): the user
   * opened the PR in the detail pane. Its thread is marked read on GitHub,
   * like a visit on github.com, when a mark-read would leave every tile
   * holding it done and none is snoozed (`openedReadCheck`), and only while
   * writes are unlocked. Same write and mirror as the sync's quiet
   * mark-reads, no undo window. True when GitHub took it.
   */
  async markOpened(prKey: PrKey): Promise<boolean> {
    if (!this.writes.enabled()) {
      return false;
    }
    const nowIso = this.now().toISOString();
    const board = Board.load(this.store, nowIso);
    const thread = board.threads.get(prKey);
    if (!thread) {
      return false;
    }
    const check = openedReadCheck({ thread, prFetchedAt: this.store.prs.fetchedAtByKey().get(prKey) ?? null, tiles: this.tilesHolding(board, prKey) });
    if (check.kind === 'skip') {
      return false;
    }
    const marked = await this.markOne({ thread, prKey, detail: quietReasonDetail('opened') });
    if (marked) {
      advanceSeenFromGitHub(this.store, [prKey], nowIso);
    }
    return marked;
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
