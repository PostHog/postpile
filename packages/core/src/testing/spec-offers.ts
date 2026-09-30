// The buttons restated from the spec (DESIGN "Actions act on what you look
// at", "Tile faces", "Rules layer: one home per fact"): the tile footer,
// the lead PR and the detail pane per PR, from the tile's state and the
// rows' facts (done, unseen count, move, after-read), which the rule
// invariants check on their own. Type imports only from the rule modules.
import { sameLogin } from '../mentions.ts';
import type { GitHubLinkOffer, MarkLabel, PaneLead, TileFooterAction } from '../offers.ts';
import type { PrPrimaryAction } from '../primary-action.ts';
import type { Pr, PrKey, UserPrState, Viewer } from '../types.ts';
import type { PrSummary, TileView } from '../views.ts';
import { isAutomationLogin, isViewerTeam, viewerApproved } from './spec-facts.ts';

function isTrackedRow(row: PrSummary): boolean {
  return row.provenance.kind !== 'pulled_in';
}

/** Done, its news seen and its thread read on GitHub: a row with nothing left to mark. */
function settled(row: PrSummary): boolean {
  return row.done && row.unseenLoudEvents === 0 && !row.unreadOnGitHub;
}

/**
 * Done: Open. Snoozed with every tracked PR done, seen and read on GitHub:
 * Open (the snooze can still be taken back). Unread: Mark read. Read and
 * your move: Snooze. Else Mark done when a mark-read leaves the tile done,
 * Mark read if not.
 */
export function expectedFooter(view: TileView): TileFooterAction {
  if (view.state.kind === 'done') {
    return 'open';
  }
  const tracked = view.prs.filter(isTrackedRow);
  if (view.state.kind === 'snoozed' && tracked.length > 0 && tracked.every(settled)) {
    return 'open';
  }
  if (view.state.kind === 'unread') {
    return 'mark_read';
  }
  if (view.state.kind === 'open' && view.turn.kind === 'you') {
    return 'snooze';
  }
  return view.afterRead.done ? 'mark_done' : 'mark_read';
}

export function expectedMarkLabel(action: string): MarkLabel | null {
  if (action === 'mark_done') {
    return 'Mark done';
  }
  return action === 'mark_read' ? 'Mark read' : null;
}

/** The PR of the turn, else the one behind the newest unread reason, else the first open tracked PR, else the first. */
export function expectedLeadPr(view: TileView): PrKey | null {
  const keys = view.prs.map((row) => row.key);
  if (view.turn.kind !== 'none' && view.turn.prKey !== null && keys.includes(view.turn.prKey)) {
    return view.turn.prKey;
  }
  const newestReason = view.state.unreadBecause.at(-1)?.prKey ?? null;
  if (newestReason !== null && keys.includes(newestReason)) {
    return newestReason;
  }
  return view.prs.find((row) => isTrackedRow(row) && row.state === 'OPEN')?.key ?? keys[0] ?? null;
}

/** Next to Snooze: the move's PR (else the lead's), "Open on GitHub" for your own, "Review on GitHub" on the files tab otherwise. */
export function expectedGitHubLink(view: TileView, viewer: Viewer): GitHubLinkOffer | null {
  const row = view.prs.find((candidate) => candidate.key === view.turn.prKey) ?? view.prs.find((candidate) => candidate.key === expectedLeadPr(view));
  if (!row || row.url === '') {
    return null;
  }
  return sameLogin(row.author, viewer.login) ? { label: 'Open on GitHub', url: row.url, filesTab: false } : { label: 'Review on GitHub', url: row.url, filesTab: true };
}

/** Approve on someone else's open PR (Approved once the viewer did), else Mark read while the tile is unread, else Open. */
export function expectedPrimaryAction(pr: Pr, viewer: Viewer, userState: UserPrState | null, tileUnread: boolean): PrPrimaryAction {
  if (pr.state === 'OPEN' && !sameLogin(pr.author, viewer.login)) {
    return viewerApproved(pr, viewer, userState) ? 'approved' : 'approve';
  }
  return tileUnread ? 'mark_read' : 'open_on_github';
}

/**
 * One PR's mark button on a stack or set: news to mark; nothing on a
 * pulled-in PR; on a done PR or while it is your move only Mark read for a
 * thread unread on GitHub; else by the after-read.
 */
function prMark(view: TileView, row: PrSummary): 'mark_read' | 'mark_done' | 'none' {
  if (view.state.kind === 'done') {
    return 'none';
  }
  if (row.unseenLoudEvents > 0) {
    return 'mark_read';
  }
  if (!isTrackedRow(row)) {
    return 'none';
  }
  if (row.done || row.turn.kind === 'you') {
    return row.unreadOnGitHub ? 'mark_read' : 'none';
  }
  return row.afterRead.done ? 'mark_done' : 'mark_read';
}

export interface ExpectedPane {
  scope: 'tile' | 'pr';
  lead: PaneLead;
  approve: boolean;
  open: boolean;
  ask: boolean;
  markLabel: MarkLabel | null;
  snooze: boolean;
  removeTeams: string[];
}

/**
 * The detail pane for one PR: on a single-PR tile the buttons act on the
 * tile, on a stack or set on that PR. A done PR (or any PR of a done tile)
 * offers no Approve, Ask or Remove team; with its news seen and its thread
 * read nothing to mark either. Approve leads on someone else's open, not yet approved,
 * non-draft PR; else the mark button; else Open on GitHub.
 */
export function expectedPane(view: TileView, row: PrSummary, pr: Pr, viewer: Viewer): ExpectedPane {
  const scope = view.tile.members.length <= 1 ? 'tile' : 'pr';
  const finished = view.state.kind === 'done' || row.done;
  const primary = row.primaryAction;
  const approve = !finished && (primary === 'approve' || primary === 'approved');
  let mark: TileFooterAction | 'none' = 'none';
  if (!settled(row)) {
    mark = scope === 'tile' ? expectedFooter(view) : prMark(view, row);
  }
  let lead: PaneLead;
  if (approve && primary === 'approve' && !row.isDraft) {
    lead = 'approve';
  } else if (mark === 'open' || mark === 'none') {
    lead = 'open_on_github';
  } else {
    lead = mark;
  }
  return {
    scope,
    lead,
    approve,
    open: lead === 'open_on_github' || (!approve && primary !== 'mark_read'),
    ask: !finished && !isAutomationLogin(pr.author) && !sameLogin(pr.author, viewer.login),
    markLabel: expectedMarkLabel(mark),
    snooze: scope === 'tile' && view.state.kind !== 'done',
    removeTeams: finished || pr.state !== 'OPEN' ? [] : pr.reviewerTeams.filter((team) => isViewerTeam(viewer, team)),
  };
}
