import {
  isClearableNonPr,
  isTracked,
  judgedReadCheck,
  judgedReadDetail,
  openedReadCheck,
  prAfterMarkRead,
  prReadScope,
  quietReadCheck,
  quietReadDetail,
  quietReasonDetail,
  QUIET_READS_PER_RUN,
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
import { readLocally } from '../actions/local-change.ts';
import type { GitHubWrites } from './github-writes.ts';
import { markThreadReadIfUnchanged } from './thread-mark-read.ts';

/** A thread that passed the rules, with the action log detail that says why. `prKey` is null for a notification that is not a PR. */
interface QuietCandidate {
  thread: NotificationThread;
  prKey: PrKey | null;
  detail: string;
}

export interface QuietReadsResult {
  /** PR threads marked read on GitHub. */
  marked: PrKey[];
  /** Notifications that are not PRs (releases, issues) marked read on GitHub, by thread id. */
  otherMarked: string[];
  errors: string[];
}

const NOTHING_DONE: QuietReadsResult = { marked: [], otherMarked: [], errors: [] };

/**
 * The log detail when a thread may be marked read: only bots since the last
 * read, else the user acted after it, else everything since they last looked
 * is automation or a person the events agent judged as not needing them.
 */
function quietDetail(input: QuietReadInput): string | null {
  const bots = quietReadCheck(input);
  if (bots.kind === 'mark') {
    return quietReadDetail(bots.bots);
  }
  const touched = touchedReadCheck(input);
  if (touched.kind === 'mark') {
    return quietReasonDetail(touched.reason);
  }
  const judged = judgedReadCheck(input);
  if (judged.kind === 'mark') {
    return judgedReadDetail(judged.actors);
  }
  return null;
}

/**
 * "Handled quietly" (DESIGN.md): after a full sync, PR threads the user had
 * read that turned unread only because of bots get marked read on GitHub,
 * when nothing is asked of the user (`quietReadCheck`), and so do threads
 * whose unread events all came before the user's own review or comment
 * (`touchedReadCheck`, "You already dealt with it"), and threads where
 * everything since the user last looked is automation or a person's
 * activity the events agent judged as not needing them (`judgedReadCheck`,
 * "GitHub unread is PostPile unread"). Notifications that are not PRs are
 * marked read too (`isClearableNonPr`): PostPile shows none of them. Only
 * while GitHub writes are unlocked: locked, nothing happens and nothing
 * piles up as a pending write, and the thread stays unread in PostPile.
 * Each thread is read again right before the write and left alone when it
 * moved since the sync. Every write goes through GitHubWrites and is logged
 * with origin `quiet`.
 */
export class QuietReads {
  constructor(
    private readonly store: Store,
    private readonly reader: GitHubReader,
    private readonly writes: GitHubWrites,
    private readonly now: () => Date,
  ) {}

  /** PR threads the rules may mark read. Whether the tile is unread is no input: an unread thread always makes it so. */
  private prCandidates(board: Board): QuietCandidate[] {
    const viewer = board.viewer;
    if (viewer === null) {
      return [];
    }
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
        notYours: board.notYours.has(prKey),
        prFetchedAt: fetchedAt.get(prKey) ?? null,
        now: board.now,
      });
      if (detail !== null) {
        result.push({ thread, prKey, detail });
      }
    }
    return result;
  }

  /** Releases, issues and other notifications that are not PRs, unread on GitHub past the grace. */
  private otherCandidates(now: string): QuietCandidate[] {
    return this.store.notifications
      .list()
      .filter((thread) => isClearableNonPr(thread, now))
      .map((thread) => ({ thread, prKey: null, detail: quietReasonDetail('not_pr') }));
  }

  /**
   * True when GitHub took the mark-read. Read elsewhere or moved since the
   * sync: left for the next run, nothing logged (unlike the queue, which
   * mirrors an already-read thread to complete the user's intent).
   */
  private async markOne(candidate: QuietCandidate): Promise<boolean> {
    const context = { origin: 'quiet' as const, prKey: candidate.prKey, detail: candidate.detail };
    const result = await markThreadReadIfUnchanged(this.reader, this.writes, candidate.thread, context);
    if (result.kind !== 'sent') {
      return false;
    }
    // Mirror GitHub: the thread is read up to its last update, and so are the events before it.
    this.store.notifications.markRead(candidate.thread.id, result.readAt);
    if (candidate.prKey !== null) {
      readLocally(this.store, prReadScope(candidate.prKey, false), { kind: 'quiet', readAt: result.readAt }, result.readAt);
    }
    return true;
  }

  /** Every tile that holds the PR, and whether one of them is snoozed. */
  private tilesHolding(board: Board, prKey: PrKey): OpenedTile[] {
    return board
      .allTiles()
      .filter((tile) => tile.members.some((member) => member.prKey === prKey))
      .map((tile) => ({ snoozed: board.stateOf(tile).kind === 'snoozed' }));
  }

  /** A mark-read of this PR alone would leave it done (the rule behind `PrSummary.afterRead`); tracked when any tile tracks it. */
  private prDoneAfterRead(board: Board, prKey: PrKey): boolean {
    const pr = board.prs.get(prKey);
    if (!pr) {
      return false;
    }
    const tracked = board
      .allTiles()
      .some((tile) => tile.members.some((member) => member.prKey === prKey && isTracked(member.provenance)));
    return prAfterMarkRead({
      pr,
      events: board.events.get(prKey) ?? [],
      userState: board.userStates.get(prKey) ?? null,
      viewer: board.viewer,
      notYours: board.notYours.has(prKey),
      tracked,
      readAt: board.now,
    }).done;
  }

  /**
   * PostPile's side of an open: every event of the PR seen and the PR
   * handled, like a mark-read of it. True when anything changed.
   */
  private handleOpened(prKey: PrKey, at: string): boolean {
    const change = readLocally(this.store, prReadScope(prKey, true), { kind: 'opened' }, at);
    return change.eventIds.length > 0 || change.handledKeys.length > 0;
  }

  /**
   * "Opened in PostPile" (DESIGN.md "You already dealt with it"): the user
   * opened the PR in the detail pane. When a mark-read of that PR would leave
   * it done and no tile holding it is snoozed (`openedReadCheck`), and only
   * while writes are unlocked: its thread is marked read on GitHub if it is
   * unread there (same write and mirror as the sync's quiet mark-reads, no
   * undo window), and the PR is handled here too (2026-09-29), events seen
   * and `handledAt` set. A thread GitHub has read already only gets the
   * PostPile side. True when anything changed.
   */
  async markOpened(prKey: PrKey): Promise<boolean> {
    if (!this.writes.enabled()) {
      return false;
    }
    const nowIso = this.now().toISOString();
    const board = Board.load(this.store, nowIso);
    const thread = board.threads.get(prKey) ?? null;
    const check = openedReadCheck({
      thread,
      prFetchedAt: this.store.prs.fetchedAtByKey().get(prKey) ?? null,
      prTruncated: this.store.prs.get(prKey)?.truncated === true,
      tiles: this.tilesHolding(board, prKey),
      doneAfterRead: this.prDoneAfterRead(board, prKey),
    });
    if (check.kind === 'skip' || thread === null) {
      return false;
    }
    if (check.kind === 'mark') {
      const marked = await this.markOne({ thread, prKey, detail: quietReasonDetail('opened') });
      if (!marked) {
        return false;
      }
    }
    const handled = this.handleOpened(prKey, nowIso);
    if (check.kind === 'handle' && handled) {
      // GitHub had it read already: logged like any mark-read that only changed the app.
      this.writes.log.record({ action: 'mark_read', origin: 'quiet', outcome: 'local', prKey, threadId: thread.id, detail: 'no unread GitHub thread' });
    }
    advanceSeenFromGitHub(this.store, [prKey], nowIso);
    return check.kind === 'mark' || handled;
  }

  async run(): Promise<QuietReadsResult> {
    if (!this.writes.enabled()) {
      return NOTHING_DONE;
    }
    const nowIso = this.now().toISOString();
    const result: QuietReadsResult = { marked: [], otherMarked: [], errors: [] };
    // One budget for both, PR threads first: they are what the tiles show.
    const candidates = [...this.prCandidates(Board.load(this.store, nowIso)), ...this.otherCandidates(nowIso)].slice(0, QUIET_READS_PER_RUN);
    for (const candidate of candidates) {
      try {
        if (!(await this.markOne(candidate))) {
          continue;
        }
        if (candidate.prKey === null) {
          result.otherMarked.push(candidate.thread.id);
        } else {
          result.marked.push(candidate.prKey);
        }
      } catch (error) {
        // GitHubWrites logged it as failed; the thread stays unread and the next sync tries again.
        result.errors.push(`quiet mark-read of ${candidate.prKey ?? `notification ${candidate.thread.id}`}: ${errorText(error)}`);
      }
    }
    advanceSeenFromGitHub(this.store, result.marked, nowIso);
    return result;
  }
}
