import { openedReadCheck, planRead, prReadScope, type OpenedReadInput, type OpenedReadResult, type OpenedSkip, type PrKey } from '@postpile/core';
import type { Store } from '@postpile/store';
import { Board } from '../board.ts';
import type { GitHubWrites } from '../writes/github-writes.ts';
import { OpenedReadInputs } from '../writes/opened-read-inputs.ts';
import type { ReadMarker } from './read-marker.ts';

const NOT_MARKED: OpenedReadResult = { marked: false, undoToken: null, undoUntil: null };

/** Why an open marked nothing, for the text log: "stale_snapshot (fetched …, thread updated …)". */
function openedSkipDetail(why: OpenedSkip, input: OpenedReadInput): string {
  if (why === 'stale_snapshot') {
    return `${why} (snapshot fetched ${input.prFetchedAt ?? 'never'}, thread updated ${input.thread?.updatedAt ?? 'never'})`;
  }
  return why;
}

/**
 * "Opened in PostPile" (DESIGN.md "You already dealt with it", part 3): the
 * PR stayed in the detail pane through the 1.5s dwell. When a mark-read of
 * that PR would leave it done and no tile holding it is snoozed
 * (`openedReadCheck`), and only while writes are unlocked, it is marked read
 * like the detail pane's Mark read: events seen and the PR handled here right
 * away, its unread thread queued for GitHub. Since 2026-10-01 ("Marked when
 * the dwell ends") the mark fires while the PR is still on screen, so it goes
 * through the mark-read queue and its undo window: GitHub has no mark-unread,
 * and the button's Undo has to be able to take it back.
 */
export class OpenedReads {
  constructor(
    private readonly store: Store,
    private readonly readMarker: ReadMarker,
    private readonly writes: GitHubWrites,
    private readonly now: () => Date,
    private readonly textLog: (line: string) => void = () => {},
  ) {}

  /** Whether a read of the PR changes anything here: unseen events, or not handled yet. */
  private changesAnything(prKey: PrKey, at: string): boolean {
    const scope = prReadScope(prKey, true);
    const plan = planRead({
      scope,
      cause: { kind: 'opened' },
      events: this.store.events.listForPrs(scope.prKeys),
      userStates: this.store.userPrStates.getMany(scope.prKeys),
      at,
    });
    return plan.change.eventIds.length > 0 || plan.change.handledKeys.length > 0;
  }

  markOpened(prKey: PrKey): OpenedReadResult {
    if (!this.writes.enabled()) {
      return NOT_MARKED;
    }
    const nowIso = this.now().toISOString();
    const board = Board.load(this.store, nowIso);
    const input = new OpenedReadInputs(board, this.store).of(prKey);
    const check = openedReadCheck(input);
    if (check.kind === 'skip') {
      this.textLog(`opened read of ${prKey} skipped: ${openedSkipDetail(check.why, input)}`);
      return NOT_MARKED;
    }
    // GitHub has the thread read already and the PR is seen and handled here: nothing to mark, nothing to undo.
    if (check.kind === 'handle' && !this.changesAnything(prKey, nowIso)) {
      return NOT_MARKED;
    }
    const tileId = board.allTiles().find((tile) => tile.members.some((member) => member.prKey === prKey))?.id ?? null;
    const batch = this.readMarker.markRead(prReadScope(prKey, true), { kind: 'opened' }, { origin: 'detail', tileId });
    return { marked: true, undoToken: batch.token, undoUntil: new Date(batch.dueAt).toISOString() };
  }
}
