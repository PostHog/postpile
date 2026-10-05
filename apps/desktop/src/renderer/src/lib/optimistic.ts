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
 * The tile after Mark read / Done for now: done (Dealt with) or open and whose
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
 * A snoozed tile: snoozed wins over unread, open and done while it holds.
 * It stays in Unread only while a thread is unread on GitHub, as core's
 * group says for a snoozed tile; unread only by pulled-in news or a Look
 * closer event, it goes to Open. The strip and its NEW pill go.
 */
export function snoozedTile(view: TileView): TileView {
  const state: TileState = { ...view.state, kind: 'snoozed', unreadBecause: [], unseenMerges: undefined, muted: undefined };
  return { ...view, state, group: state.unreadOnGitHub ? 'unread' : 'open', newBadge: false };
}

/**
 * A muted tile: snoozed and saying Muted. With GitHub writes on, the mute's
 * mark-read shows at once too (`markedReadTile`); locked, the thread stays
 * unread like any locked mark-read, so the tile keeps its Unread place.
 */
export function mutedTile(view: TileView, writesOn: boolean): TileView {
  const snoozed = snoozedTile(view);
  const muted: TileView = { ...snoozed, state: { ...snoozed.state, muted: true } };
  return writesOn ? markedReadTile(muted) : muted;
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

/**
 * Approve of these PRs, as the engine leaves it: each approved row is
 * handled (news seen, nothing asked, `afterRead`'s move) and loses its unread
 * dot. The tile goes to done when that leaves every tracked row done and
 * nothing unread, to open when only the unread went; the agent Approve on it
 * is gone. The refetch brings core's real answer.
 */
export function approvedPrsTile(view: TileView, prKeys: PrKey[]): TileView {
  if (!view.prs.some((pr) => prKeys.includes(pr.key))) {
    return view;
  }
  const prs = view.prs.map((pr) => (prKeys.includes(pr.key) ? { ...markedPrRow(pr), done: true } : pr));
  const unreadPrKeys = view.unreadPrKeys.filter((key) => !prKeys.includes(key));
  const next = { ...view, prs, unreadPrKeys, agent: { ...view.agent, approve: null } };
  const snoozed = view.state.kind === 'snoozed';
  if (snoozed || unreadPrKeys.length > 0) {
    return next;
  }
  const done = prs.filter((pr) => pr.provenance.kind !== 'pulled_in').every((pr) => pr.done);
  return {
    ...next,
    state: { kind: done ? 'done' : 'open', unreadBecause: [], unreadOnGitHub: false, loud: false },
    group: done ? 'dealt_with' : 'open',
    newBadge: false,
  };
}

/** Every tile of a topic that holds one of the PRs, after their approval. */
export function withApprovedPrs(detail: TopicDetail, prKeys: PrKey[]): TopicDetail {
  return { ...detail, tiles: detail.tiles.map((view) => approvedPrsTile(view, prKeys)) };
}

/** Applies `change` to several tiles of a topic in one pass, so one cache change (and one rollback snapshot) covers them all. */
export function withTiles(detail: TopicDetail, tileIds: string[], change: (view: TileView) => TileView): TopicDetail {
  return tileIds.reduce((current, tileId) => withTile(current, tileId, change), detail);
}
