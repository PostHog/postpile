import {
  isClearableNonPr,
  judgedReadCheck,
  judgedReadDetail,
  prReadScope,
  quietReadCheck,
  quietReadDetail,
  quietReasonDetail,
  QUIET_READS_PER_RUN,
  touchedReadCheck,
  type NotificationThread,
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
 * "Handled quietly" (DESIGN.md): after a full sync and after a poll cycle
 * that stored a change, PR threads the user had
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
 * moved since the sync or poll stored it. Every write goes through
 * GitHubWrites and is logged with origin `quiet`. The engine never runs two
 * at once: the poll cycle that runs it and the full sync never overlap.
 */
export class QuietReads {
  constructor(
    private readonly store: Store,
    private readonly reader: GitHubReader,
    private readonly writes: GitHubWrites,
    private readonly now: () => Date,
    private readonly textLog: (line: string) => void = () => {},
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
      });
      if (detail !== null) {
        result.push({ thread, prKey, detail });
      }
    }
    return result;
  }

  /** Releases, issues and other notifications that are not PRs, unread on GitHub. */
  private otherCandidates(): QuietCandidate[] {
    return this.store.notifications
      .list()
      .filter((thread) => isClearableNonPr(thread))
      .map((thread) => ({ thread, prKey: null, detail: quietReasonDetail('not_pr') }));
  }

  /**
   * True when GitHub took the mark-read. Read elsewhere or moved since the
   * sync or poll: left for the next run, nothing logged (unlike the queue, which
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

  /** One summary line per kind of thread marked, prefixed with who ran it ("sync", "poll"). */
  private logMarked(origin: string, result: QuietReadsResult): void {
    if (result.marked.length > 0) {
      this.textLog(`${origin}: handled quietly: ${result.marked.length} threads marked read on GitHub (only bots, you acted after it, or nothing that needs you since you last looked)`);
    }
    if (result.otherMarked.length > 0) {
      this.textLog(`${origin}: handled quietly: ${result.otherMarked.length} notifications that are not PRs marked read on GitHub`);
    }
  }

  async run(origin: 'sync' | 'poll'): Promise<QuietReadsResult> {
    if (!this.writes.enabled()) {
      return NOTHING_DONE;
    }
    const nowIso = this.now().toISOString();
    const result: QuietReadsResult = { marked: [], otherMarked: [], errors: [] };
    // One budget for both, PR threads first: they are what the tiles show.
    const candidates = [...this.prCandidates(Board.load(this.store, nowIso)), ...this.otherCandidates()].slice(0, QUIET_READS_PER_RUN);
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
        // GitHubWrites logged it as failed; the thread stays unread and the next run tries again.
        result.errors.push(`quiet mark-read of ${candidate.prKey ?? `notification ${candidate.thread.id}`}: ${errorText(error)}`);
      }
    }
    advanceSeenFromGitHub(this.store, result.marked, nowIso);
    this.logMarked(origin, result);
    return result;
  }
}
