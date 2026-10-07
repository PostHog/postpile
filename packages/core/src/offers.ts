// What the tile's and the detail pane's buttons say and do (DESIGN.md "Rules
// layer: one home per fact", "Actions are a separate projection"). Offers
// depend on more than a PR's facts: PR or whole tile, snooze, pending writes,
// the PR's primary action. Worked out here once, shipped as
// `TileView.offers`; the renderer only displays them.
import { isTracked } from './provenance.ts';
import { tileVerdict } from './tile-verdict.ts';
import type { PrKey, TileState } from './types.ts';
import type { PrSummary, TilePendingWrite, TileView } from './views.ts';

/**
 * The tile footer's main action:
 * - open: the tile is done, the button opens it. Nothing else is offered
 *   on a done tile: no mark button, no Snooze. Also on a snoozed tile whose
 *   tracked PRs are all done with their news seen, like its detail pane;
 *   Snooze stays there so the snooze can be taken back.
 * - mark_read: "Mark read". The tile is unread, or a mark-read leaves something asked.
 * - mark_done: "Done for now". The tile is read and a mark-read makes it done.
 * - snooze: the tile is read and still your move. Marking read changes
 *   nothing you can see, so Snooze is the primary button and "Review on
 *   GitHub" sits next to it.
 */
export type TileFooterAction = 'open' | 'mark_read' | 'mark_done' | 'snooze';

export type MarkLabel = 'Mark read' | 'Done for now';

/**
 * The detail pane's one ink button, placed first:
 * - approve: Approve is due (someone else's open PR, not a draft, not
 *   approved yet, not done).
 * - mark_read / mark_done: the mark button.
 * - snooze: single-PR tile only, read and still your move, as on the tile.
 * - open_on_github: on a stack or set the selected PR is not done but has
 *   nothing to mark.
 * - none: the tile or the selected PR is done with nothing left to mark. No
 *   ink button: Open on GitHub stays outlined, so on a dealt-with topic
 *   "Archive now" is the one ink button on screen (2026-10-07).
 */
export type PaneLead = 'approve' | 'mark_read' | 'mark_done' | 'snooze' | 'open_on_github' | 'none';

/**
 * The quieter link next to Snooze: "Review on GitHub" opens the files tab of
 * someone else's PR (`filesTab`); on your own PR it is "Open on GitHub" and
 * opens the PR.
 */
export interface GitHubLinkOffer {
  label: 'Review on GitHub' | 'Open on GitHub';
  url: string;
  filesTab: boolean;
}

/** The detail pane's buttons for one PR of the tile. */
export interface PaneOffers {
  /**
   * tile: a single-PR tile, where the tile and the PR are the same and the
   * buttons act on the tile. pr: a stack or set, where they act on the
   * selected PR only (2026-09-29, "Actions act on what you look at").
   */
  scope: 'tile' | 'pr';
  lead: PaneLead;
  /** Show Approve; its label and look ("Approve again", "Approve draft") stay display. */
  approve: boolean;
  /** Show "Ask <author>": not on your own PR, not to automation, not on a done PR. */
  ask: boolean;
  /** The mark button's label, null for none. */
  markLabel: MarkLabel | null;
  /** Show Snooze: single-PR tiles only (a set is snoozed from its footer), never on a done tile. */
  snooze: boolean;
  /** One "Remove <team>" per team of yours still asked on the PR; none on a done PR. */
  removeTeams: string[];
  /** The pending write the mark button waits on: the tile's on a single-PR tile, else the PR's own. */
  pendingWrite: TilePendingWrite | null;
}

export interface TileOffers {
  /**
   * The PR the tile is mostly about: the PR of the tile's turn when there is
   * one (so the verdict pill talks about the same PR as the footer), else
   * the one behind the newest unread reason, else the first open pinged or
   * found PR, else the first PR.
   */
  leadPrKey: PrKey | null;
  footer: TileFooterAction;
  /** The footer's mark button label; null when it shows none (done, or read and still your move). */
  markLabel: MarkLabel | null;
  /** Show the footer's Snooze menu: on every tile that is not done, also a snoozed one that leads with Open. */
  snooze: boolean;
  /** Next to Snooze when the footer leads with it; null otherwise. */
  github: GitHubLinkOffer | null;
  /**
   * Show "Not mine" in the tile's ⋯ menu: not while the tile's verdict pill
   * already says Not yours (`notMineOffer`).
   */
  notMine: boolean;
  /**
   * "Unmute the rest" in the Snooze menu: the tile came back while some of
   * its PRs are still muted (`TileState.partlyMuted`), and it is not done.
   * A muted tile itself offers Unmute in Snooze's place instead, and a
   * snoozed one Unsnooze.
   */
  unmuteRest: boolean;
  /** The detail pane's buttons, by PR key. */
  pane: Record<PrKey, PaneOffers>;
}

/** What the offers read of the tile view. */
export type OfferView = Pick<TileView, 'tile' | 'state' | 'turn' | 'afterRead' | 'prs' | 'pendingWrite'>;

/** What the pane offers read of one PR row. */
export type OfferPr = Pick<
  PrSummary,
  | 'key'
  | 'url'
  | 'isDraft'
  | 'provenance'
  | 'state'
  | 'authorRelation'
  | 'primaryAction'
  | 'done'
  | 'turn'
  | 'afterRead'
  | 'unseenLoudEvents'
  | 'unreadOnGitHub'
  | 'pendingWrite'
  | 'ownTeamRequests'
  | 'facts'
>;

/** A done PR with its news seen and its thread read on GitHub: nothing is left to mark. */
function nothingToMark(pr: Pick<OfferPr, 'done' | 'unseenLoudEvents' | 'unreadOnGitHub'>): boolean {
  return pr.done && pr.unseenLoudEvents === 0 && !pr.unreadOnGitHub;
}

/** Every tracked PR of the tile is done, its news seen and its thread read: nothing is left to mark. */
function everyTrackedPrDoneAndSeen(view: Pick<TileView, 'prs'>): boolean {
  const tracked = view.prs.filter((pr) => isTracked(pr.provenance));
  return tracked.length > 0 && tracked.every(nothingToMark);
}

export function tileFooterAction(view: Pick<TileView, 'state' | 'turn' | 'afterRead' | 'prs'>): TileFooterAction {
  if (view.state.kind === 'done') {
    return 'open';
  }
  // A snoozed tile with nothing left to mark leads with Open, like its pane (2026-09-29).
  if (view.state.kind === 'snoozed' && everyTrackedPrDoneAndSeen(view)) {
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

function markLabelOf(action: TileFooterAction | PrMarkAction): MarkLabel | null {
  if (action === 'mark_done') {
    return 'Done for now';
  }
  return action === 'mark_read' ? 'Mark read' : null;
}

/**
 * The pane's mark action for one PR of a stack or set, by the tile's rule
 * applied to that PR:
 * - mark_read: the PR has unseen news, or a mark-read of it leaves something
 *   asked, or it is done or your move while its thread is unread on GitHub.
 * - mark_done: a mark-read of it makes that PR done.
 * - none: nothing to mark. The tile is done, the PR is done already (thread
 *   read) or a pulled-in layer without news, or it is read and still your
 *   move (then Open on GitHub leads; Snooze stays in the tile footer on a set).
 */
export type PrMarkAction = 'mark_read' | 'mark_done' | 'none';

export function prMarkAction(
  state: Pick<TileState, 'kind'>,
  pr: Pick<OfferPr, 'provenance' | 'done' | 'turn' | 'afterRead' | 'unseenLoudEvents' | 'unreadOnGitHub'>,
): PrMarkAction {
  if (state.kind === 'done') {
    return 'none';
  }
  if (pr.unseenLoudEvents > 0) {
    return 'mark_read';
  }
  if (pr.provenance.kind === 'pulled_in') {
    return 'none';
  }
  if (pr.done || pr.turn.kind === 'you') {
    return pr.unreadOnGitHub ? 'mark_read' : 'none';
  }
  return pr.afterRead.done ? 'mark_done' : 'mark_read';
}

/** The newest reason the tile is unread. */
function newestUnreadPrKey(view: Pick<TileView, 'state'>): PrKey | null {
  const reasons = view.state.unreadBecause;
  return reasons[reasons.length - 1]?.prKey ?? null;
}

export function leadPrKey(view: Pick<TileView, 'state' | 'turn' | 'prs'>): PrKey | null {
  const keys = new Set(view.prs.map((pr) => pr.key));
  if (view.turn.kind !== 'none' && view.turn.prKey !== null && keys.has(view.turn.prKey)) {
    return view.turn.prKey;
  }
  const reasonKey = newestUnreadPrKey(view);
  if (reasonKey !== null && keys.has(reasonKey)) {
    return reasonKey;
  }
  const openPinged = view.prs.find((pr) => pr.provenance.kind !== 'pulled_in' && pr.state === 'OPEN');
  return openPinged?.key ?? view.prs[0]?.key ?? null;
}

/** The PR the move is about, else the lead PR; "Review on GitHub" for someone else's, "Open on GitHub" for your own. */
function githubLink(view: OfferView, leadKey: PrKey | null): GitHubLinkOffer | null {
  const pr = view.prs.find((candidate) => candidate.key === view.turn.prKey) ?? view.prs.find((candidate) => candidate.key === leadKey);
  if (!pr || !pr.url) {
    return null;
  }
  if (pr.authorRelation === 'you') {
    return { label: 'Open on GitHub', url: pr.url, filesTab: false };
  }
  return { label: 'Review on GitHub', url: pr.url, filesTab: true };
}

/**
 * The detail pane's buttons for one PR. A done PR offers only Open, like a
 * done tile (2026-09-29: a handled PR by someone else with no ask still got
 * a primary Approve). A done PR whose news or unread thread keeps its tile
 * unread keeps Mark read, but no Approve, Ask or Remove team. On a snoozed single-PR tile a
 * done PR keeps Snooze, so the snooze can be taken back.
 */
export function paneOffers(view: OfferView, pr: OfferPr): PaneOffers {
  const scope = view.tile.members.length <= 1 ? 'tile' : 'pr';
  const finished = view.state.kind === 'done' || pr.done;
  const approve = !finished && (pr.primaryAction === 'approve' || pr.primaryAction === 'approved');
  // A done PR has nothing to mark once its news is seen and its thread read, also on a snoozed tile.
  const doneAndSeen = nothingToMark(pr);
  let mark: TileFooterAction | PrMarkAction = 'none';
  if (!doneAndSeen) {
    mark = scope === 'tile' ? tileFooterAction(view) : prMarkAction(view.state, pr);
  }
  let lead: PaneLead;
  if (approve && pr.primaryAction === 'approve' && !pr.isDraft) {
    lead = 'approve';
  } else if (mark === 'open' || mark === 'none') {
    lead = finished ? 'none' : 'open_on_github';
  } else {
    lead = mark;
  }
  return {
    scope,
    lead,
    approve,
    ask: !finished && !pr.facts.ownerIsAutomation && pr.authorRelation !== 'you',
    markLabel: markLabelOf(mark),
    snooze: scope === 'tile' && view.state.kind !== 'done',
    removeTeams: finished ? [] : pr.ownTeamRequests,
    pendingWrite: scope === 'tile' ? view.pendingWrite : pr.pendingWrite,
  };
}

/**
 * "Not mine" says the tile is not the viewer's: it clears the tile and
 * teaches the agent. When the tile's verdict pill already says Not yours
 * (stale or not, the way the rules read it), the agent agrees and there is
 * nothing to teach, so the menu leaves it out and Mark read is the way to
 * clear the tile (2026-10-05). The pill is the worst glance among the open
 * tracked PRs (`tileVerdict`), so a stack or set reads Not yours only when
 * every open PR it tracks does; one Not yours PR next to a Look closer one
 * keeps "Not mine", which then still says something about the rest.
 */
export function notMineOffer(view: Pick<OfferView, 'prs'>, lead: PrKey | null): boolean {
  return tileVerdict(view.prs, lead)?.verdict !== 'NOT_YOURS';
}

/** Every button of the tile: footer, lead PR and the detail pane per PR. */
export function tileOffers(view: OfferView): TileOffers {
  const footer = tileFooterAction(view);
  const lead = leadPrKey(view);
  const pane: Record<PrKey, PaneOffers> = {};
  for (const pr of view.prs) {
    pane[pr.key] = paneOffers(view, pr);
  }
  return {
    leadPrKey: lead,
    footer,
    markLabel: markLabelOf(footer),
    snooze: view.state.kind !== 'done',
    github: footer === 'snooze' ? githubLink(view, lead) : null,
    unmuteRest: view.state.kind !== 'done' && view.state.kind !== 'snoozed' && view.state.partlyMuted === true,
    notMine: notMineOffer(view, lead),
    pane,
  };
}
