// What a click shows before the server answers (DESIGN.md "Actions act on
// what you look at"). Built only from fields core already ships (afterRead,
// the snooze state, the head commit); where those don't say enough, the
// data stays as it is and the button shows its pending state instead.
// The next refetch replaces all of it with the server's answer.
import type { IsoTime, PrDetail, PrKey, PrSummary, TileState, TileView, TopicDetail } from '@postpile/core';

/** A PR row after a mark-read of it: news seen, and a tracked PR takes its `afterRead`. */
function markedPrRow(pr: PrSummary): PrSummary {
  const tracked = pr.provenance.kind !== 'pulled_in';
  return {
    ...pr,
    unseenLoudEvents: 0,
    unreadOnGitHub: false,
    done: tracked ? pr.afterRead.done : pr.done,
    turn: tracked ? pr.afterRead.turn : pr.turn,
  };
}

/**
 * The tile after Mark read / Mark done: done (Dealt with) or open and whose
 * move as its `afterRead` says, every row marked, its threads read. A
 * snoozed tile keeps its snooze (the snooze outlasts a mark-read) and goes
 * to Open; its rows still change. The one place the renderer names a group
 * itself: a guess from `afterRead` until the refetch brings core's.
 */
export function markedReadTile(view: TileView): TileView {
  const snoozed = view.state.kind === 'snoozed';
  const done = !snoozed && view.afterRead.done;
  const state: TileState = snoozed
    ? { ...view.state, unreadOnGitHub: false, loud: false }
    : { kind: done ? 'done' : 'open', unreadBecause: [], unreadOnGitHub: false, loud: false };
  return { ...view, state, group: done ? 'dealt_with' : 'open', newBadge: false, turn: view.afterRead.turn, prs: view.prs.map(markedPrRow), unreadPrKeys: [] };
}

/**
 * The detail pane's Mark read on one PR of a stack or set: only that row
 * changes. The tile's own state depends on its other PRs too, which is the
 * server's call, so it waits for the refetch.
 */
export function markedReadPr(view: TileView, prKey: PrKey): TileView {
  return { ...view, prs: view.prs.map((pr) => (pr.key === prKey ? markedPrRow(pr) : pr)), unreadPrKeys: view.unreadPrKeys.filter((key) => key !== prKey) };
}

/**
 * A snoozed tile: snoozed wins over unread, open and done while it holds. It
 * keeps its group (an unread thread keeps it in Unread; a done tile offers
 * no snooze); only the strip and its NEW pill go.
 */
export function snoozedTile(view: TileView): TileView {
  return { ...view, state: { ...view.state, kind: 'snoozed', unreadBecause: [], unseenMerges: undefined }, newBadge: false };
}

/** The PR after the viewer's approval of the commit on screen, so Approve turns into "Approved". */
export function approvedDetail(detail: PrDetail, at: IsoTime): PrDetail {
  return { ...detail, viewerApproval: { at, commitOid: detail.pr.headOid } };
}

/** Applies `change` to one tile of a topic; any other topic comes back as it was. */
export function withTile(detail: TopicDetail, tileId: string, change: (view: TileView) => TileView): TopicDetail {
  if (!detail.tiles.some((view) => view.tile.id === tileId)) {
    return detail;
  }
  return { ...detail, tiles: detail.tiles.map((view) => (view.tile.id === tileId ? change(view) : view)) };
}
