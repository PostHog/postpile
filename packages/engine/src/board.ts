import {
  buildTopicTiles,
  stackByPrKey,
  stackTopicId,
  deriveTileState,
  newTopic,
  prKeyFromTileId,
  setIdFromTileId,
  whoseTurn,
  withGroups,
  type HotSelection,
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
import { readHotSet, readStoreShape, threadsByPrKey } from './hot-set.ts';
import { loadViewer } from './viewer-meta.ts';

/** PRs the agent has not placed yet. Not stored: it is whatever has no membership. */
export const UNSORTED_TOPIC_ID = 'unsorted';

function unsortedTopic(): Topic {
  return { ...newTopic(UNSORTED_TOPIC_ID, 'Unsorted', ''), summary: 'Waiting for the agent. Each sync places these in a topic.' };
}

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

/** What picked the last hot board per store: the busy inbox view reads it without a load of its own. */
const lastSelection = new WeakMap<Store, HotSelection>();

/**
 * Everything needed to derive tiles and their state, loaded from the store
 * in one go. Tiles and state are never stored; they are derived on every
 * read. The shared Board (`load`) holds the hot PRs only (DESIGN.md "Big
 * inboxes: what PostPile loads and works on"); a scoped Board (`forTopic`,
 * `forPr`, `forTile`) reads a cold topic or PR on demand and is let go
 * after the request.
 */
export class Board {
  /** The stacks whose layers are on this board; a stack is always on it whole or not at all. */
  readonly stacks: Stack[];
  /** The one topic each stack shows in, by stack id: every stored stack, so a cold PR's topic is known too. */
  readonly stackTopicIds: Map<string, string>;
  /** Every stored stack by layer, on the board or not. */
  private readonly stackOf: Map<PrKey, Stack>;
  private readonly allStacks: Stack[];
  private readonly tileCache = new Map<string, Tile[]>();
  /** Tile state and whose turn by tile id, worked out once per Board (one snapshot). */
  private readonly stateCache = new Map<string, TileState>();
  private readonly turnCache = new Map<string, WhoseTurn>();
  /** The member PRs on this board, by topic; built on first use (one pass over the memberships, not one per topic). */
  private membersByTopic: Map<string, PrKey[]> | null = null;
  /** Why each pulled-in layer is here, by PR; built on first use. */
  private pullInReasonsByKey: Map<PrKey, string> | null = null;

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
    /** Every stored stack (`readStoreShape`). */
    allStacks: Stack[],
  ) {
    this.allStacks = allStacks;
    this.stacks = allStacks.filter((stack) => prs.has(stack.prKeys[0]!));
    this.stackOf = stackByPrKey(allStacks);
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
    for (const stack of this.allStacks) {
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

  private static assemble(store: Store, now: string, prs: Map<PrKey, Pr>, threads: Map<PrKey, NotificationThread>, stacks: Stack[]): Board {
    const keys = [...prs.keys()];
    return new Board(
      store,
      now,
      loadViewer(store),
      prs,
      threads,
      store.events.listForPrs(keys),
      store.userPrStates.getMany(keys),
      new Map(store.memberships.listAll().map((m) => [m.prKey, m])),
      new Map(store.snoozes.list().map((snooze) => [snooze.prKey, snooze])),
      store.pullIns.listAll(),
      store.foundPrs.listAll(),
      notYoursKeys(store, keys),
      stacks,
    );
  }

  private static readHot(store: Store, now: string): Board {
    const threads = threadsByPrKey(store.notifications.list());
    const hot = readHotSet(store, now, threads);
    lastSelection.set(store, hot.selection);
    const prs = store.prs.keepParsed([...hot.selection.keys]);
    return Board.assemble(store, now, prs, threads, hot.shape.stacks);
  }

  /**
   * The hot Board of the store as it is now: the PRs `selectHotBoard`
   * keeps, each with its whole stack and set. A Board loaded from the same
   * data (`Store.changeVersion`) at most BOARD_REUSE_MS earlier is handed
   * out again: on a busy install a refetch after a poll, the Dock badge and
   * a catch-up each loading their own went past the main process's 4 GB
   * heap. A Board is read-only, so sharing it is safe; its `now` is then up
   * to BOARD_REUSE_MS behind the caller's.
   */
  static load(store: Store, now: string): Board {
    const version = store.changeVersion();
    const last = lastLoaded.get(store);
    if (last && last.version === version && isReusableAt(last.board.now, now)) {
      return last.board;
    }
    // Let go of the old Board before reading the new one, so both never sit in memory for the cache's sake.
    lastLoaded.delete(store);
    const board = Board.readHot(store, now);
    lastLoaded.set(store, { version, board });
    return board;
  }

  /** What picked the last hot Board, or null before the first load. */
  static lastSelection(store: Store): HotSelection | null {
    return lastSelection.get(store) ?? null;
  }

  /**
   * A Board of these PRs with their stacks and sets, read for one request:
   * nothing goes into the shared cache, and it is let go with the request.
   */
  static forPrs(store: Store, now: string, seeds: PrKey[]): Board {
    const shape = readStoreShape(store);
    const prs = store.prs.getMany([...withGroups(seeds, shape.groups)]);
    return Board.assemble(store, now, prs, threadsByPrKey(store.notifications.list()), shape.stacks);
  }

  /**
   * Every PR of the topic: the hot Board when it holds them all (and for
   * Unsorted, which is whatever the hot Board has without a topic), else a
   * Board of the topic's PRs read for this request only. Opening a topic in
   * the Archive, or one whose older PRs went cold, shows it whole.
   */
  static forTopic(store: Store, now: string, topicId: string): Board {
    const hot = Board.load(store, now);
    if (topicId === UNSORTED_TOPIC_ID) {
      return hot;
    }
    const memberKeys = store.memberships.listForTopic(topicId).map((membership) => membership.prKey);
    return memberKeys.every((key) => hot.prs.has(key)) ? hot : Board.forPrs(store, now, memberKeys);
  }

  /** A Board that holds the PR: the hot one, else its topic's PRs and the PR itself, read for this request only. */
  static forPr(store: Store, now: string, key: PrKey): Board {
    const hot = Board.load(store, now);
    if (hot.prs.has(key)) {
      return hot;
    }
    const topicId = hot.topicIdOf(key);
    const topicKeys = topicId === null || topicId === UNSORTED_TOPIC_ID ? [] : store.memberships.listForTopic(topicId).map((membership) => membership.prKey);
    return Board.forPrs(store, now, [...topicKeys, key]);
  }

  /** A Board that holds the tile: the hot one, else the tile's topic read for this request (a cold tile the topic pane shows). */
  static forTile(store: Store, now: string, tileId: string): Board {
    const hot = Board.load(store, now);
    if (hot.findTile(tileId)) {
      return hot;
    }
    const setId = setIdFromTileId(tileId);
    const key = prKeyFromTileId(tileId);
    const topicId = setId !== null ? (store.sets.get(setId)?.topicId ?? null) : key !== null ? hot.topicIdOf(key) : null;
    return topicId === null ? hot : Board.forTopic(store, now, topicId);
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
    if (this.membersByTopic === null) {
      this.membersByTopic = new Map();
      for (const membership of this.memberships.values()) {
        if (this.prs.has(membership.prKey)) {
          this.membersByTopic.set(membership.topicId, [...(this.membersByTopic.get(membership.topicId) ?? []), membership.prKey]);
        }
      }
    }
    return this.membersByTopic.get(topicId) ?? [];
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

  private pullInReasons(): Map<PrKey, string> {
    this.pullInReasonsByKey ??= new Map([...this.pullIns.values()].map((pullIn) => [pullIn.prKey, pullIn.reason]));
    return this.pullInReasonsByKey;
  }

  tilesForTopic(topicId: string): Tile[] {
    const cached = this.tileCache.get(topicId);
    if (cached) {
      return cached;
    }
    // A set loads whole or not at all (`withGroups`): one whose PRs are not on this board is left out.
    const sets = topicId === UNSORTED_TOPIC_ID ? [] : this.store.sets.listActiveForTopic(topicId).filter((set) => set.members.some((member) => this.prs.has(member.prKey)));
    const tiles = buildTopicTiles({
      topicId,
      memberKeys: this.memberKeys(topicId),
      prs: this.prs,
      threads: this.threads,
      stacks: this.stacks,
      stackTopicIds: this.stackTopicIds,
      sets,
      events: this.events,
      pullInReasons: this.pullInReasons(),
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
