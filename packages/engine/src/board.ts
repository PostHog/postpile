import {
  buildStacks,
  buildTopicTiles,
  stackByPrKey,
  stackTopicId,
  deriveTileState,
  newTopic,
  whoseTurn,
  prKey,
  type NotificationThread,
  type Pr,
  type PrEvent,
  type PrKey,
  type PullIn,
  type FoundPr,
  type Snooze,
  type Stack,
  type Tile,
  type TileState,
  type Topic,
  type TopicMembership,
  type UserPrState,
  type Viewer,
  type WhoseTurn,
} from '@postpile/core';
import type { Store } from '@postpile/store';
import { loadViewer } from './viewer-meta.ts';

/** PRs the agent has not placed yet. Not stored: it is whatever has no membership. */
export const UNSORTED_TOPIC_ID = 'unsorted';

function unsortedTopic(): Topic {
  return { ...newTopic(UNSORTED_TOPIC_ID, 'Unsorted', ''), summary: 'Waiting for the agent. Each sync places these in a topic.' };
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
function notYoursKeys(store: Store, keys: PrKey[]): Set<PrKey> {
  const result = new Set<PrKey>();
  for (const [key, glance] of store.glances.getMany(keys)) {
    if (glance.verdict === 'NOT_YOURS') {
      result.add(key);
    }
  }
  return result;
}

/** How long a loaded Board answers later loads of unchanged data. Tile state reads times in minutes and up. */
export const BOARD_REUSE_MS = 5_000;

/** A Board loaded at `loadedAt` can stand in for one at `now`: not earlier, and not more than BOARD_REUSE_MS later. */
function isReusableAt(loadedAt: string, now: string): boolean {
  const age = Date.parse(now) - Date.parse(loadedAt);
  return age >= 0 && age <= BOARD_REUSE_MS;
}

interface LoadedBoard {
  version: string;
  board: Board;
}

/** The last Board loaded per store (`Board.load`). */
const lastLoaded = new WeakMap<Store, LoadedBoard>();

export class Board {
  readonly stacks: Stack[];
  /** The one topic each stack shows in, by stack id. */
  readonly stackTopicIds: Map<string, string>;
  private readonly stackOf: Map<PrKey, Stack>;
  private readonly tileCache = new Map<string, Tile[]>();
  /** Tile state and whose turn by tile id, worked out once per Board (one snapshot). */
  private readonly stateCache = new Map<string, TileState>();
  private readonly turnCache = new Map<string, WhoseTurn>();

  private constructor(
    private readonly store: Store,
    readonly now: string,
    readonly viewer: Viewer | null,
    readonly prs: Map<PrKey, Pr>,
    readonly threads: Map<PrKey, NotificationThread>,
    readonly events: Map<PrKey, PrEvent[]>,
    readonly userStates: Map<PrKey, UserPrState>,
    readonly memberships: Map<PrKey, TopicMembership>,
    /** Snoozes by PR. */
    private readonly snoozes: Map<PrKey, Snooze>,
    readonly pullIns: Map<PrKey, PullIn>,
    readonly found: Map<PrKey, FoundPr>,
    /** PRs whose stored glance says NOT_YOURS, stale or not, so tile state and whose turn agree (see `teamRequestHold`). */
    readonly notYours: Set<PrKey>,
  ) {
    this.stacks = buildStacks([...prs.values()]);
    this.stackOf = stackByPrKey(this.stacks);
    this.stackTopicIds = this.placeStacks();
  }

  private isTracked(key: PrKey): boolean {
    return this.threads.has(key) || this.found.has(key);
  }

  /**
   * A stack shows where its newest layer membership in an active topic says
   * (see `stackTopicId`), or in Unsorted while a tracked layer waits for a topic.
   */
  private placeStacks(): Map<string, string> {
    const result = new Map<string, string>();
    const activeTopicIds = new Set(this.store.topics.listActive().map((topic) => topic.id));
    for (const stack of this.stacks) {
      const topicId = stackTopicId(stack, this.memberships, activeTopicIds);
      if (topicId !== null) {
        result.set(stack.id, topicId);
      } else if (stack.prKeys.some((key) => this.isTracked(key))) {
        result.set(stack.id, UNSORTED_TOPIC_ID);
      }
    }
    return result;
  }

  /** The topic the stack of this PR shows in, or null when it is no stack layer. */
  stackTopicIdOf(key: PrKey): string | null {
    const stack = this.stackOf.get(key);
    return stack ? (this.stackTopicIds.get(stack.id) ?? null) : null;
  }

  /** Every layer of the stack this PR is in, bottom first; just the PR when it is in none. */
  stackKeysOf(key: PrKey): PrKey[] {
    return this.stackOf.get(key)?.prKeys ?? [key];
  }

  /**
   * The PRs that change topic together with this one: every layer of its
   * stack that is tracked or has a topic. Pulled-in layers have no topic of
   * their own and follow the stack anyway.
   */
  movesWith(key: PrKey): PrKey[] {
    return this.stackKeysOf(key).filter((layer) => layer === key || this.memberships.has(layer) || this.isTracked(layer));
  }

  /**
   * The Board of the store as it is now. A Board loaded from the same data
   * (`Store.changeVersion`) at most BOARD_REUSE_MS earlier is handed out
   * again: on a busy install one load holds hundreds of MB, and a refetch
   * after a poll, the Dock badge and a catch-up each loading their own went
   * past the main process's 4 GB heap. A Board is read-only, so sharing it
   * is safe; its `now` is then up to BOARD_REUSE_MS behind the caller's.
   */
  static load(store: Store, now: string): Board {
    const version = store.changeVersion();
    const last = lastLoaded.get(store);
    if (last && last.version === version && isReusableAt(last.board.now, now)) {
      return last.board;
    }
    // Let go of the old Board before reading the new one, so both never sit in memory for the cache's sake.
    lastLoaded.delete(store);
    const board = Board.read(store, now);
    lastLoaded.set(store, { version, board });
    return board;
  }

  private static read(store: Store, now: string): Board {
    const prs = new Map(store.prs.listAll().map((pr) => [pr.key, pr]));
    const keys = [...prs.keys()];
    const events = store.events.listForPrs(keys);
    return new Board(
      store,
      now,
      loadViewer(store),
      prs,
      threadsByPrKey(store.notifications.list()),
      events,
      store.userPrStates.getMany(keys),
      new Map(store.memberships.listAll().map((m) => [m.prKey, m])),
      new Map(store.snoozes.list().map((snooze) => [snooze.prKey, snooze])),
      store.pullIns.listAll(),
      store.foundPrs.listAll(),
      notYoursKeys(store, keys),
    );
  }

  /** PRs with a notification thread, or found by the sync, that have no topic yet and no stack showing in a topic. */
  private unsortedKeys(): PrKey[] {
    return [...this.prs.keys()].filter(
      (key) => !this.memberships.has(key) && this.isTracked(key) && (this.stackTopicIdOf(key) ?? UNSORTED_TOPIC_ID) === UNSORTED_TOPIC_ID,
    );
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
      stackTopicIds: this.stackTopicIds,
      sets,
      events: this.events,
      pullInReasons: new Map([...this.pullIns.values()].map((pullIn) => [pullIn.prKey, pullIn.reason])),
      found: this.found,
    });
    this.tileCache.set(topicId, tiles);
    return tiles;
  }

  allTiles(): Tile[] {
    return this.topics().flatMap((topic) => this.tilesForTopic(topic.id));
  }

  /** A stack shows in one topic only, so a tile id is found once. */
  findTile(tileId: string): Tile | null {
    return this.allTiles().find((tile) => tile.id === tileId) ?? null;
  }

  stateOf(tile: Tile): TileState {
    const cached = this.stateCache.get(tile.id);
    if (cached) {
      return cached;
    }
    const state = deriveTileState({
      tile,
      prs: this.prs,
      events: this.events,
      threads: this.threads,
      userStates: this.userStates,
      snoozes: this.snoozes,
      now: this.now,
      viewer: this.viewer,
      notYours: this.notYours,
    });
    this.stateCache.set(tile.id, state);
    return state;
  }

  turnOf(tile: Tile): WhoseTurn {
    const cached = this.turnCache.get(tile.id);
    if (cached) {
      return cached;
    }
    const turn = whoseTurn({ tile, prs: this.prs, events: this.events, userStates: this.userStates, viewer: this.viewer, notYours: this.notYours });
    this.turnCache.set(tile.id, turn);
    return turn;
  }

  /**
   * A stack layer is in the topic its stack shows in. A pulled-in layer
   * outside any stack left shows in the topic of the pinged PR it hangs off.
   */
  topicIdOf(key: PrKey): string | null {
    const stackTopic = this.stackTopicIdOf(key);
    if (stackTopic !== null) {
      return stackTopic;
    }
    const membership = this.memberships.get(key);
    if (membership) {
      return membership.topicId;
    }
    if ((this.threads.has(key) || this.found.has(key)) && this.prs.has(key)) {
      return UNSORTED_TOPIC_ID;
    }
    const anchor = this.pullIns.get(key)?.anchorPrKey;
    return anchor && anchor !== key ? this.topicIdOf(anchor) : null;
  }
}
