import { pingClickTarget, type MacNotification, type PingTarget, type PrKey, type Tile } from '@postpile/core';
import { Board, UNSORTED_TOPIC_ID } from '../board.ts';

/** Where a PR sits on the board now: its topic and the tile there that holds it. */
export interface BoardPlace {
  topicId: string;
  /** The tile it was pinged in when several hold it; null when no tile does. */
  tile: Tile | null;
}

/** Null when the PR is in no topic anymore. */
export function placeOnBoard(board: Board, key: PrKey): BoardPlace | null {
  const topicId = board.topicIdOf(key);
  if (topicId === null) {
    return null;
  }
  const holding = board.tilesForTopic(topicId).filter((tile) => tile.members.some((member) => member.prKey === key));
  const tile = holding.find((candidate) => candidate.members.some((m) => m.prKey === key && m.provenance.kind === 'pinged')) ?? holding[0] ?? null;
  return { topicId, tile };
}

/** A topic the app can still open: active or finished, or Unsorted while it holds PRs. Not one merged away (archived). */
function topicOpenable(board: Board, topicId: string): boolean {
  if (topicId === UNSORTED_TOPIC_ID) {
    return board.topics().some((topic) => topic.id === UNSORTED_TOPIC_ID);
  }
  const topic = board.topic(topicId);
  return topic !== null && topic.status !== 'archived';
}

/** Where a click on this Mac notification goes on the board as it is now (`pingClickTarget`). */
export function pingClickTargetOnBoard(board: Board, notification: Pick<MacNotification, 'target' | 'prKeys'>): PingTarget | null {
  return pingClickTarget(
    notification,
    (key) => {
      const place = placeOnBoard(board, key);
      return place ? { topicId: place.topicId, tileId: place.tile?.id ?? null } : null;
    },
    (topicId) => topicOpenable(board, topicId),
  );
}
