import {
  buildStacks,
  buildTopicTiles,
  deriveTileState,
  prKey,
  type NotificationThread,
  type Pr,
  type PrEvent,
  type PrKey,
  type Snooze,
  type Stack,
  type Tile,
  type TileState,
  type Topic,
  type TopicMembership,
  type UserPrState,
} from '@code-manager/core';
import type { Store } from '@code-manager/store';
import { loadViewer } from './viewer-meta.ts';

/** PRs the agent has not placed yet. Not stored: it is whatever has no membership. */
export const UNSORTED_TOPIC_ID = 'unsorted';

function unsortedTopic(): Topic {
  return {
    id: UNSORTED_TOPIC_ID,
    name: 'Unsorted',
    summary: 'PRs the agent has not placed in a topic yet.',
    summaryInputHash: null,
    tailoring: '',
    driver: null,
    userRole: 'watcher',
    status: 'active',
    createdAt: '',
    updatedAt: '',
  };
}

function threadsByPrKey(threads: NotificationThread[]): Map<PrKey, NotificationThread> {
  const result = new Map<PrKey, NotificationThread>();
  // Threads come newest first; the newest one per PR wins.
  for (const thread of threads) {
    if (thread.subjectType !== 'PullRequest' || thread.number === null) {
      continue;
    }
    const key = prKey({ repo: thread.repo, number: thread.number });
    if (!result.has(key)) {
      result.set(key, thread);
    }
  }
  return result;
}

/**
 * Everything needed to derive tiles and their state, loaded from the store in
 * one go. Tiles and state are never stored; every read builds a fresh Board.
 */
export class Board {
  readonly stacks: Stack[];
  private readonly tileCache = new Map<string, Tile[]>();

  private constructor(
    private readonly store: Store,
    readonly now: string,
    readonly viewerLogin: string | undefined,
    readonly prs: Map<PrKey, Pr>,
    readonly threads: Map<PrKey, NotificationThread>,
    readonly events: Map<PrKey, PrEvent[]>,
    readonly userStates: Map<PrKey, UserPrState>,
    readonly memberships: Map<PrKey, TopicMembership>,
    private readonly snoozes: Map<string, Snooze>,
  ) {
    this.stacks = buildStacks([...prs.values()]);
  }

  static load(store: Store, now: string): Board {
    const prs = new Map(store.prs.listAll().map((pr) => [pr.key, pr]));
    const keys = [...prs.keys()];
    return new Board(
      store,
      now,
      loadViewer(store)?.login,
      prs,
      threadsByPrKey(store.notifications.list()),
      store.events.listForPrs(keys),
      store.userPrStates.getMany(keys),
      new Map(store.memberships.listAll().map((m) => [m.prKey, m])),
      new Map(store.snoozes.list().map((s) => [s.tileId, s])),
    );
  }

  private unsortedKeys(): PrKey[] {
    return [...this.prs.keys()].filter((key) => !this.memberships.has(key) && this.threads.has(key));
  }

  private memberKeys(topicId: string): PrKey[] {
    if (topicId === UNSORTED_TOPIC_ID) {
      return this.unsortedKeys();
    }
    return [...this.memberships.values()]
      .filter((m) => m.topicId === topicId && this.prs.has(m.prKey))
      .map((m) => m.prKey);
  }

  /** Active topics, plus the Unsorted topic when anything is waiting for a topic. */
  topics(): Topic[] {
    const topics = this.store.topics.listActive();
    return this.unsortedKeys().length > 0 ? [...topics, unsortedTopic()] : topics;
  }

  topic(topicId: string): Topic | null {
    if (topicId === UNSORTED_TOPIC_ID) {
      return unsortedTopic();
    }
    return this.store.topics.get(topicId);
  }

  tilesForTopic(topicId: string): Tile[] {
    const cached = this.tileCache.get(topicId);
    if (cached) {
      return cached;
    }
    const sets = topicId === UNSORTED_TOPIC_ID ? [] : this.store.sets.listActiveForTopic(topicId);
    const tiles = buildTopicTiles({
      topicId,
      memberKeys: this.memberKeys(topicId),
      prs: this.prs,
      threads: this.threads,
      stacks: this.stacks,
      sets,
      events: this.events,
    });
    this.tileCache.set(topicId, tiles);
    return tiles;
  }

  allTiles(): Tile[] {
    return this.topics().flatMap((topic) => this.tilesForTopic(topic.id));
  }

  /** A stack tile shows up in every topic owning one of its PRs; the first one found is returned. */
  findTile(tileId: string): Tile | null {
    return this.allTiles().find((tile) => tile.id === tileId) ?? null;
  }

  stateOf(tile: Tile): TileState {
    return deriveTileState({
      tile,
      prs: this.prs,
      events: this.events,
      userStates: this.userStates,
      snooze: this.snoozes.get(tile.id) ?? null,
      now: this.now,
      viewerLogin: this.viewerLogin,
    });
  }

  topicIdOf(key: PrKey): string | null {
    const membership = this.memberships.get(key);
    if (membership) {
      return membership.topicId;
    }
    return this.threads.has(key) && this.prs.has(key) ? UNSORTED_TOPIC_ID : null;
  }
}
