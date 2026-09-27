import {
  displayState,
  isUnseenLoud,
  TILE_STATE_ORDER,
  type PrDetail,
  type PrKey,
  type PrSummary,
  type Tile,
  type TileView,
  type TopicDetail,
  type TopicListItem,
} from '@code-manager/core';
import type { Store } from '@code-manager/store';
import { Board, UNSORTED_TOPIC_ID } from './board.ts';

function compareTopics(a: TopicListItem, b: TopicListItem): number {
  if (a.group !== b.group) {
    return a.group === 'needs_you' ? -1 : 1;
  }
  if (a.unreadTiles !== b.unreadTiles) {
    return b.unreadTiles - a.unreadTiles;
  }
  // Unsorted goes last within its group so real topics come first.
  if ((a.topic.id === UNSORTED_TOPIC_ID) !== (b.topic.id === UNSORTED_TOPIC_ID)) {
    return a.topic.id === UNSORTED_TOPIC_ID ? 1 : -1;
  }
  return a.topic.name.localeCompare(b.topic.name);
}

/** Builds the API read models. Every call loads a fresh Board, so state is always derived. */
export class ReadModels {
  constructor(
    private readonly store: Store,
    private readonly now: () => Date,
  ) {}

  private board(): Board {
    return Board.load(this.store, this.now().toISOString());
  }

  private prSummaries(board: Board, tile: Tile): PrSummary[] {
    const glances = this.store.glances.getMany(tile.members.map((m) => m.prKey));
    const summaries: PrSummary[] = [];
    for (const member of tile.members) {
      const pr = board.prs.get(member.prKey);
      if (!pr) {
        continue;
      }
      summaries.push({
        key: pr.key,
        title: pr.title,
        url: pr.url,
        author: pr.author,
        state: pr.state,
        isDraft: pr.isDraft,
        provenance: member.provenance,
        verdict: glances.get(pr.key)?.verdict ?? null,
        unseenLoudEvents: (board.events.get(pr.key) ?? []).filter(isUnseenLoud).length,
      });
    }
    return summaries;
  }

  private tileViews(board: Board, topicId: string): TileView[] {
    const views = board.tilesForTopic(topicId).map((tile) => ({
      tile,
      state: board.stateOf(tile),
      prs: this.prSummaries(board, tile),
    }));
    return views.sort((a, b) => TILE_STATE_ORDER[a.state.kind] - TILE_STATE_ORDER[b.state.kind]);
  }

  listTopics(): TopicListItem[] {
    const board = this.board();
    const items: TopicListItem[] = [];
    for (const topic of board.topics()) {
      const states = board.tilesForTopic(topic.id).map((tile) => board.stateOf(tile).kind);
      if (states.length === 0) {
        continue;
      }
      const unreadTiles = states.filter((kind) => kind === 'unread').length;
      items.push({
        topic,
        group: unreadTiles > 0 ? 'needs_you' : 'quiet',
        unreadTiles,
        openTiles: states.filter((kind) => kind === 'open').length,
        totalTiles: states.length,
      });
    }
    return items.sort(compareTopics);
  }

  getTopic(topicId: string): TopicDetail | null {
    const board = this.board();
    const topic = board.topic(topicId);
    if (!topic) {
      return null;
    }
    const isUnsorted = topicId === UNSORTED_TOPIC_ID;
    return {
      topic,
      tiles: this.tileViews(board, topicId),
      sets: isUnsorted ? [] : this.store.sets.listActiveForTopic(topicId),
      pendingProposals: isUnsorted ? [] : this.store.proposals.listPendingForTopic(topicId),
    };
  }

  getPr(key: PrKey): PrDetail | null {
    const board = this.board();
    const pr = board.prs.get(key);
    if (!pr) {
      return null;
    }
    const tileIds = new Set(
      board
        .allTiles()
        .filter((tile) => tile.members.some((m) => m.prKey === key))
        .map((tile) => tile.id),
    );
    return {
      pr,
      events: (board.events.get(key) ?? []).map((event) => ({ event, display: displayState(event) })),
      glance: this.store.glances.get(key),
      userState: board.userStates.get(key) ?? null,
      topicId: board.topicIdOf(key),
      tileIds: [...tileIds],
    };
  }
}
