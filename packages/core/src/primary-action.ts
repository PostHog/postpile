// The detail pane's primary button for a PR. Rules only, shared by the
// engine and FakeEngine through `PrSummary.primaryAction`.
import type { PersonRelation } from './topic-queues.ts';
import type { PrState } from './types.ts';

/**
 * approve: approve on GitHub. approved: the viewer's approval covers the
 * current head (a disabled "Approved"). mark_read: the tile has unread news
 * and there is nothing to approve. open_on_github: nothing to approve and
 * nothing unread.
 */
export type PrPrimaryAction = 'approve' | 'approved' | 'mark_read' | 'open_on_github';

export interface PrimaryActionInput {
  state: PrState;
  authorRelation: PersonRelation;
  /** The viewer's approval (app or github.com) is for the current head commit. */
  approvedHead: boolean;
  /** The tile holding the PR is unread. */
  tileUnread: boolean;
}

/** GitHub never lets you approve your own PR, and only open PRs take a review. */
export function canApprove(input: Pick<PrimaryActionInput, 'state' | 'authorRelation'>): boolean {
  return input.state === 'OPEN' && input.authorRelation !== 'you';
}

/**
 * Approve only where it makes sense: an open PR someone else wrote whose head
 * the viewer has not approved yet. On the viewer's own PR (and on merged or
 * closed ones) the primary action is Mark read while the tile is unread, else
 * Open on GitHub.
 */
export function prPrimaryAction(input: PrimaryActionInput): PrPrimaryAction {
  if (canApprove(input)) {
    return input.approvedHead ? 'approved' : 'approve';
  }
  return input.tileUnread ? 'mark_read' : 'open_on_github';
}
