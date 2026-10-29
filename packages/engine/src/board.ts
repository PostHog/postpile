import {
  buildTopicTiles,
  stackByPrKey,
  stackTopicId,
  deriveTileState,
  newTopic,
  prKeyFromTileId,
  scoutIdOfTopic,
  scoutedFound,
  scoutStackOwner,
  scoutTopicId,
  setIdFromTileId,
  whoseTurn,
  withGroups,
  UNSORTED_TOPIC_ID,
  type HotSelection,
  type NotificationThread,
  type Pr,
  type PrEvent,
  type PrKey,
  type PullIn,
  type FoundPr,
  type ScoutedPr,
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
import { readHotSet, readStoreShape, threadsByPrKey, type StoreShape } from './hot-set.ts';
import { loadViewer } from './viewer-meta.ts';

// PRs the agent has not placed yet; core owns the id so its sidebar order can put Unsorted last.
export { UNSORTED_TOPIC_ID };

function unsortedTopic(): Topic {
  return { ...newTopic(UNSORTED_TOPIC_ID, 'Unsorted', ''), summary: 'Waiting for the agent. Each sync places these in a topic.' };
}

function scoutTopic(topicId: string, name: string): Topic {
  return { ...newTopic(topicId, name, ''), summary: 'PRs this scout pulled in from outside your GitHub inbox.' };
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
  /** Every member PR by topic, on this board or not; built on first use (one pass over the memberships, not one per topic). */
  private keysByTopic: Map<string, PrKey[]> | null = null;
  /** Why each pulled-in layer is here, by PR; built on first use. */
  private pullInReasonsByKey: Map<PrKey, string> | null = null;
  /**
   * The scout each stack outside the inbox shows with (DESIGN.md "Scouts"),
   * by stack id: only stacks no normal topic or Unsorted holds. Kept apart
   * from `stackTopicIds`, so nothing that reads a PR's topic sees a scout.
   */
  private readonly scoutStackIds: Map<string, string>;

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
    /** Every stored PR's key, on this board or not. */
    private readonly stored: ReadonlySet<PrKey>,
    /**
     * PRs scouts pulled in that are still on the Scouted section (not
     * followed, dismissed or expired), by PR. Display only: they never make
     * a PR tracked (DESIGN.md "Scouts").
     */
    readonly scouted: Map<PrKey, ScoutedPr>,
  ) {
    this.allStacks = allStacks;
    this.stacks = allStacks.filter((stack) => prs.has(stack.prKeys[0]!));
    this.stackOf = stackByPrKey(allStacks);
    this.stackTopicIds = this.placeStacks();
    this.scoutStackIds = this.placeScoutStacks();
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

  /** A scouted PR on the Scouted section: active, and not tracked normally (that tile wins). */
  private isScoutedOnly(key: PrKey): boolean {
    return this.scouted.has(key) && !this.isTracked(key) && !this.memberships.has(key);
  }

  /**
   * Stacks with no place in a normal topic but a scouted layer: shown whole
   * with the scout that pulled any of its layers first (`scoutStackOwner`).
   * A stack with a tracked layer shows in its normal topic, where the
   * scouted layers ride along as context.
   */
  private placeScoutStacks(): Map<string, string> {
    const result = new Map<string, string>();
    const onlyScouted = new Map([...this.scouted].filter(([key]) => this.isScoutedOnly(key)));
    for (const stack of this.allStacks) {
      if (this.stackTopicIds.has(stack.id)) {
        continue;
      }
      const owner = scoutStackOwner(stack.prKeys, onlyScouted);
      if (owner !== null) {
        result.set(stack.id, scoutTopicId(owner));
      }
    }
    return result;
  }

  /** The scout's pseudo-topic a scouted-only PR shows in ("scout:<id>"), its stack's owner first; null for any other PR. */
  scoutTopicIdOf(key: PrKey): string | null {
    const stack = this.stackOf.get(key);
    const stackScout = stack ? this.scoutStackIds.get(stack.id) : undefined;
    if (stackScout !== undefined) {
      return stackScout;
    }
    if (stack && this.stackTopicIds.has(stack.id)) {
      return null;
    }
    const row = this.scouted.get(key);
    return row && this.isScoutedOnly(key) ? scoutTopicId(row.scoutId) : null;
  }

  /** The scouts with a tile on this board, by id, each with the newest name its PRs were pulled under. */
  scoutIds(): Map<string, string> {
    const result = new Map<string, string>();
    for (const row of this.scouted.values()) {
      if (this.prs.has(row.prKey) && this.scoutTopicIdOf(row.prKey) === scoutTopicId(row.scoutId)) {
        result.set(row.scoutId, row.scoutName);
      }
    }
    return result;
  }

  /** The topic the stack of this PR shows in, or null when it is no stack layer. */
  stackTopicIdOf(key: PrKey): string | null {
    const stack = this.stackOf.get(key);
    return stack ? (this.stackTopicIds.get(stack.id) ?? null) : null;
  }

  /**
   * The layer below this PR when its body declares it ("Stacked on #12")
   * rather than its base branch: null for a branch link or no stack.
   */
  declaredParentKeyOf(key: PrKey): PrKey | null {
    const stack = this.stackOf.get(key);
    if (!stack?.declaredLinks?.includes(key)) {
      return null;
    }
    return stack.prKeys[stack.prKeys.indexOf(key) - 1] ?? null;
  }

  /** `below` is a lower layer of the stack `key` is in, however they are linked. */
  isLayerBelow(below: PrKey, key: PrKey): boolean {
    const layers = this.stackOf.get(key)?.prKeys ?? [];
    const index = layers.indexOf(below);
    return index >= 0 && index < layers.indexOf(key);
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

  private static assemble(store: Store, now: string, prs: Map<PrKey, Pr>, threads: Map<PrKey, NotificationThread>, shape: StoreShape): Board {
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
      shape.stacks,
      new Set(shape.headers.map((pr) => pr.key)),
      new Map(store.scoutedPrs.listActive().map((row) => [row.prKey, row])),
    );
  }

  private static readHot(store: Store, now: string): Board {
    const threads = threadsByPrKey(store.notifications.list());
    const hot = readHotSet(store, now, threads);
    lastSelection.set(store, hot.selection);
    const prs = store.prs.keepParsed([...hot.selection.keys]);
    return Board.assemble(store, now, prs, threads, hot.shape);
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
    return Board.assemble(store, now, prs, threadsByPrKey(store.notifications.list()), shape);
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
    const scoutId = scoutIdOfTopic(topicId);
    if (scoutId !== null) {
      // A busy inbox leaves tier "others" off the hot board, which is where most scouted PRs rank.
      const scoutedKeys = store.scoutedPrs.listActive().filter((row) => row.scoutId === scoutId).map((row) => row.prKey);
      return scoutedKeys.every((key) => hot.prs.has(key)) ? hot : Board.forPrs(store, now, scoutedKeys);
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
    const scouted = key !== null ? store.scoutedPrs.get(key) : null;
    const topicId = setId !== null ? (store.sets.get(setId)?.topicId ?? null) : key !== null ? (hot.topicIdOf(key) ?? (scouted ? scoutTopicId(scouted.scoutId) : null)) : null;
    return topicId === null ? hot : Board.forTopic(store, now, topicId);
  }

  /** PRs with a notification thread, or found by the sync, that have no topic yet and no stack showing in a topic. */
  private unsortedKeys(): PrKey[] {
    return [...this.prs.keys()].filter(
      (key) => !this.memberships.has(key) && this.isTracked(key) && (this.stackTopicIdOf(key) ?? UNSORTED_TOPIC_ID) === UNSORTED_TOPIC_ID,
    );
  }

  private topicKeys(topicId: string): PrKey[] {
    if (this.keysByTopic === null) {
      this.keysByTopic = new Map();
      for (const membership of this.memberships.values()) {
        const keys = this.keysByTopic.get(membership.topicId) ?? [];
        keys.push(membership.prKey);
        this.keysByTopic.set(membership.topicId, keys);
      }
    }
    return this.keysByTopic.get(topicId) ?? [];
  }

  private memberKeys(topicId: string): PrKey[] {
    if (topicId === UNSORTED_TOPIC_ID) {
      return this.unsortedKeys();
    }
    return this.topicKeys(topicId).filter((key) => this.prs.has(key));
  }


  /**
   * The topic has PRs, all stored and none on this board: on the hot board,
   * a topic that went cold as a whole. It gets no agent work until one of
   * its PRs turns hot again. A topic whose PRs are not stored yet is not.
   */
  wentCold(topicId: string): boolean {
    const keys = this.topicKeys(topicId);
    return keys.length > 0 && keys.every((key) => this.stored.has(key) && !this.prs.has(key));
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
    const scoutId = scoutIdOfTopic(topicId);
    if (scoutId !== null) {
      const name = this.scoutIds().get(scoutId) ?? [...this.scouted.values()].find((row) => row.scoutId === scoutId)?.scoutName ?? scoutId;
      return scoutTopic(topicId, name);
    }
    return this.store.topics.get(topicId);
  }

  private pullInReasons(): Map<PrKey, string> {
    this.pullInReasonsByKey ??= new Map([...this.pullIns.values()].map((pullIn) => [pullIn.prKey, pullIn.reason]));
    return this.pullInReasonsByKey;
  }

  /**
   * A scout's tiles (DESIGN.md "Scouts"): its scouted-only PRs, as found PRs
   * of `via: 'scouted'` so a tile holds them, with their stacks whole. Never
   * part of `allTiles`: no counts, unread, whose move or asks read them.
   */
  private scoutTiles(topicId: string): Tile[] {
    const memberKeys = [...this.scouted.keys()].filter((key) => this.prs.has(key) && this.scoutTopicIdOf(key) === topicId);
    const found = new Map(this.found);
    for (const key of memberKeys) {
      found.set(key, scoutedFound(this.scouted.get(key)!));
    }
    // Stacks of other scouts stay with them; a stack placed nowhere else shows here whole.
    const stackTopicIds = new Map([...this.stackTopicIds, ...this.scoutStackIds]);
    return buildTopicTiles({
      topicId,
      memberKeys,
      prs: this.prs,
      threads: this.threads,
      stacks: this.stacks,
      stackTopicIds,
      sets: [],
      events: this.events,
      pullInReasons: this.pullInReasons(),
      found,
    });
  }

  /** Every scout's tiles on this board, for finding a scout tile by id. */
  allScoutTiles(): Tile[] {
    return [...this.scoutIds().keys()].flatMap((scoutId) => this.tilesForTopic(scoutTopicId(scoutId)));
  }

  tilesForTopic(topicId: string): Tile[] {
    const cached = this.tileCache.get(topicId);
    if (cached) {
      return cached;
    }
    if (scoutIdOfTopic(topicId) !== null) {
      const tiles = this.scoutTiles(topicId);
      this.tileCache.set(topicId, tiles);
      return tiles;
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
    return this.allTiles().find((tile) => tile.id === tileId) ?? this.allScoutTiles().find((tile) => tile.id === tileId) ?? null;
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
