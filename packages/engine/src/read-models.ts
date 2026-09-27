import {
  displayState,
  isUnseenLoud,
  TILE_STATE_ORDER,
  type FactQuery,
  type FactView,
  type PrDetail,
  type PrKey,
  type PrSummary,
  type Tile,
  type TileView,
  type TopicDetail,
  type TopicListItem,
} from '@code-manager/core';
import type { AgentService } from '@code-manager/agent';
import type { Store } from '@code-manager/store';
import { Board, UNSORTED_TOPIC_ID } from './board.ts';
import { GlanceInputs } from './glance-inputs.ts';
import { MemoryReads } from './memory/memory-reads.ts';
import type { PromptContextSource } from './prompt-context.ts';
import { loadViewer } from './viewer-meta.ts';

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
  private readonly memory: MemoryReads;

  constructor(
    private readonly store: Store,
    private readonly agent: AgentService,
    private readonly contexts: PromptContextSource,
    private readonly now: () => Date,
  ) {
    this.memory = new MemoryReads(store, now);
  }

  private board(): Board {
    return Board.load(this.store, this.now().toISOString());
  }

  /**
   * PRs whose stored glance no longer matches its current input: new commits,
   * a new dossier version, changed instructions or tailoring, new feedback.
   * The hash only stops a regeneration; this stops an old verdict being shown
   * next to Approve when the last sync skipped or failed the glance.
   */
  private staleGlances(board: Board, keys: PrKey[]): Set<PrKey> {
    const glances = this.store.glances.getMany(keys);
    const viewer = loadViewer(this.store);
    if (glances.size === 0 || !viewer) {
      return new Set(glances.keys());
    }
    const inputs = new GlanceInputs(this.store, board, viewer, this.contexts);
    const targets = new Map(inputs.targets().map((target) => [target.item.pr.key, target]));
    const stale = new Set<PrKey>();
    for (const [key, glance] of glances) {
      const target = targets.get(key);
      if (!target || glance.inputHash !== inputs.itemHash(this.agent, target)) {
        stale.add(key);
      }
    }
    return stale;
  }

  private prSummaries(board: Board, tile: Tile, stale: Set<PrKey>): PrSummary[] {
    const glances = this.store.glances.getMany(tile.members.map((m) => m.prKey));
    const summaries: PrSummary[] = [];
    for (const member of tile.members) {
      const pr = board.prs.get(member.prKey);
      if (!pr) {
        continue;
      }
      const glance = glances.get(pr.key);
      summaries.push({
        key: pr.key,
        title: pr.title,
        url: pr.url,
        author: pr.author,
        state: pr.state,
        isDraft: pr.isDraft,
        provenance: member.provenance,
        verdict: glance?.verdict ?? null,
        glanceStale: stale.has(pr.key),
        forYou: glance?.forYou ?? null,
        unseenLoudEvents: (board.events.get(pr.key) ?? []).filter(isUnseenLoud).length,
        updatedAt: pr.updatedAt,
      });
    }
    return summaries;
  }

  private tileViews(board: Board, topicId: string): TileView[] {
    const tiles = board.tilesForTopic(topicId);
    const stale = this.staleGlances(board, tiles.flatMap((tile) => tile.members.map((m) => m.prKey)));
    const views = tiles.map((tile) => ({
      tile,
      state: board.stateOf(tile),
      prs: this.prSummaries(board, tile, stale),
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
      dossier: isUnsorted ? null : this.memory.dossierView(topicId, board.prs),
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
      glanceStale: this.staleGlances(board, [key]).has(key),
      userState: board.userStates.get(key) ?? null,
      topicId: board.topicIdOf(key),
      tileIds: [...tileIds],
      facts: this.memory.prFacts(key),
    };
  }

  listFacts(query: FactQuery): FactView[] {
    return this.memory.listFacts(query);
  }
}
