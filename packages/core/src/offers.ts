// What the tile's and the detail pane's buttons say and do (DESIGN.md "Rules
// layer: one home per fact", "Actions are a separate projection"). Offers
// depend on more than a PR's facts: PR or whole tile, snooze, pending writes,
// the PR's primary action. Worked out here once, shipped as
// `TileView.offers`; the renderer only displays them.
import type { PrKey, TileState } from './types.ts';
import type { PrSummary, TilePendingWrite, TileView } from './views.ts';

/**
 * The tile footer's main action:
 * - open: the tile is done, the button opens it. Nothing else is offered
 *   on a done tile: no mark button, no Snooze.
 * - mark_read: "Mark read". The tile is unread, or a mark-read leaves something asked.
 * - mark_done: "Mark done". The tile is read and a mark-read makes it done.
 * - snooze: the tile is read and still your move. Marking read changes
 *   nothing you can see, so Snooze is the primary button and "Review on
 *   GitHub" sits next to it.
 */
export type TileFooterAction = 'open' | 'mark_read' | 'mark_done' | 'snooze';

export type MarkLabel = 'Mark read' | 'Mark done';

/**
 * The detail pane's one ink button, placed first:
 * - approve: Approve is due (someone else's open PR, not a draft, not
 *   approved yet, not done).
 * - mark_read / mark_done: the mark button.
 * - snooze: single-PR tile only, read and still your move, as on the tile.
 * - open_on_github: the tile or the selected PR is done, or on a stack or
 *   set the selected PR has nothing to mark.
 */
export type PaneLead = 'approve' | 'mark_read' | 'mark_done' | 'snooze' | 'open_on_github';

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
  /** Show Open on GitHub. */
  open: boolean;
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
  /** Next to Snooze when the footer leads with it; null otherwise. */
  github: GitHubLinkOffer | null;
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
  | 'pendingWrite'
  | 'ownTeamRequests'
  | 'facts'
>;

export function tileFooterAction(view: Pick<TileView, 'state' | 'turn' | 'afterRead'>): TileFooterAction {
  if (view.state.kind === 'done') {
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
    return 'Mark done';
  }
  return action === 'mark_read' ? 'Mark read' : null;
}

/**
 * The pane's mark action for one PR of a stack or set, by the tile's rule
 * applied to that PR:
 * - mark_read: the PR has unseen news, or a mark-read of it leaves something asked.
 * - mark_done: a mark-read of it makes that PR done.
 * - none: nothing to mark. The tile is done, the PR is done already or a
 *   pulled-in layer without news, or it is read and still your move (then
 *   Open on GitHub leads; Snooze stays in the tile footer on a set).
 */
export type PrMarkAction = 'mark_read' | 'mark_done' | 'none';

export function prMarkAction(state: Pick<TileState, 'kind'>, pr: Pick<OfferPr, 'provenance' | 'done' | 'turn' | 'afterRead' | 'unseenLoudEvents'>): PrMarkAction {
  if (state.kind === 'done') {
    return 'none';
  }
  if (pr.unseenLoudEvents > 0) {
    return 'mark_read';
  }
  if (pr.provenance.kind === 'pulled_in' || pr.done || pr.turn.kind === 'you') {
    return 'none';
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
 * a primary Approve). A done PR whose news keeps its tile unread keeps Mark
 * read, but no Approve, Ask or Remove team.
 */
export function paneOffers(view: OfferView, pr: OfferPr): PaneOffers {
  const scope = view.tile.members.length <= 1 ? 'tile' : 'pr';
  const finished = view.state.kind === 'done' || pr.done;
  const approve = !finished && (pr.primaryAction === 'approve' || pr.primaryAction === 'approved');
  const mark = scope === 'tile' ? tileFooterAction(view) : prMarkAction(view.state, pr);
  let lead: PaneLead;
  if (approve && pr.primaryAction === 'approve' && !pr.isDraft) {
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
    // Where Mark read is the PR's own primary (your PR or a merged one, tile unread), Open waits until nothing is left to mark.
    open: lead === 'open_on_github' || (!approve && pr.primaryAction !== 'mark_read'),
    ask: !finished && !pr.facts.authorIsAutomation && pr.authorRelation !== 'you',
    markLabel: markLabelOf(mark),
    snooze: scope === 'tile' && view.state.kind !== 'done',
    removeTeams: finished ? [] : pr.ownTeamRequests,
    pendingWrite: scope === 'tile' ? view.pendingWrite : pr.pendingWrite,
  };
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
    github: footer === 'snooze' ? githubLink(view, lead) : null,
    pane,
  };
}
