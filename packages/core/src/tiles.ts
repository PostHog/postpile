import { isUnseenLoud, isUnseenMergeWithoutReview } from './loudness.ts';
import { isTracked, provenanceFor } from './provenance.ts';
import { isApprovedByViewer, reviewPending } from './review-request.ts';
import { snoozePhase } from './snooze.ts';
import { stackByPrKey } from './stacks.ts';
import { prWhoseTurn } from './whose-turn.ts';
import type {
  FoundPr,
  IsoTime,
  NotificationThread,
  Pr,
  PrEvent,
  PrKey,
  PrSet,
  Snooze,
  Stack,
  Tile,
  TileMember,
  TileStack,
  TileState,
  TileStateKind,
  UnreadReason,
  UserPrState,
  Viewer,
} from './types.ts';

export interface TileStateInput {
  tile: Tile;
  prs: Map<PrKey, Pr>;
  events: Map<PrKey, PrEvent[]>;
  userStates: Map<PrKey, UserPrState>;
  /** Snoozes by PR (see `isTileSnoozed`). */
  snoozes: ReadonlyMap<PrKey, Snooze>;
  now: IsoTime;
  /**
   * Lets an approval made on github.com count as done, and keeps a PR that
   * still asks something of the viewer out of done. Null: handled is enough.
   */
  viewer?: Viewer | null;
  /** PRs whose agent glance says NOT_YOURS (see `teamRequestHold`). */
  notYours?: ReadonlySet<PrKey>;
}

export interface TopicTilesInput {
  topicId: string;
  /** PRs assigned to this topic. */
  memberKeys: PrKey[];
  /** Every known PR, so stack and set members outside the topic still get titles. */
  prs: Map<PrKey, Pr>;
  threads: Map<PrKey, NotificationThread>;
  /** From buildStacks over all stored PRs. */
  stacks: Stack[];
  /**
   * The one topic each stack shows in, by stack id (see `stackTopicId`). A
   * stack listed here shows only in that topic, and its layers stay out of
   * every other topic's tiles. A stack not listed shows in each topic that
   * has one of its layers.
   */
  stackTopicIds?: Map<string, string>;
  /** Active sets of this topic. */
  sets: PrSet[];
  events?: Map<PrKey, PrEvent[]>;
  /** Why the sync pulled in a stack layer ("stack layer below #12"), by PR. */
  pullInReasons?: Map<PrKey, string>;
  /** PRs the full sync found outside the inbox, by PR. */
  found?: Map<PrKey, FoundPr>;
}

/** Most urgent first. Used to sort tiles for display and for the glance budget. */
export const TILE_STATE_ORDER: Record<TileStateKind, number> = { unread: 0, open: 1, snoozed: 2, done: 3 };

export function singleTileId(prKey: PrKey): string {
  return `pr:${prKey}`;
}

const SET_TILE_PREFIX = 'set:';

export function setTileId(setId: string): string {
  return `${SET_TILE_PREFIX}${setId}`;
}

/** The PrSet id behind a set tile id, or null for single and stack tiles. */
export function setIdFromTileId(tileId: string): string | null {
  return tileId.startsWith(SET_TILE_PREFIX) ? tileId.slice(SET_TILE_PREFIX.length) : null;
}

/**
 * A pinged PR is done only when nothing is asked of the viewer (2026-09-28):
 * merged or closed (but not while a merge without their review is unseen,
 * unless the glance says not theirs), or approved by them while whose turn is not theirs (on
 * any commit; a later push stays quiet, a later question or mention to them
 * is their move), or handled
 * (marked read) while whose turn is not theirs and no review is still
 * pending of them or their team. Marking read a PR that still waits on the
 * viewer's review makes it read, not done. Without a viewer, handled is
 * enough.
 */
export function isPrDone(pr: Pr, userState: UserPrState | null, viewer: Viewer | null = null, events: PrEvent[] = [], notYours = false): boolean {
  if (pr.state !== 'OPEN') {
    // A merge without the user's review stays until they saw it, unless the glance says it is not theirs.
    return notYours || !events.some(isUnseenMergeWithoutReview);
  }
  if (isApprovedByViewer(pr, userState, viewer?.login)) {
    // A later question or mention to the viewer still keeps it out of done.
    return viewer === null || prWhoseTurn({ pr, events, userState, viewer, notYours }).kind !== 'you';
  }
  if (!userState?.handledAt) {
    return false;
  }
  if (viewer === null) {
    return true;
  }
  if (reviewPending(pr, viewer, userState, notYours)) {
    return false;
  }
  return prWhoseTurn({ pr, events, userState, viewer, notYours }).kind !== 'you';
}

/** A found PR (no notification thread) never makes its tile unread; its events are there for whose turn and memory. */
function reasonsWhere(input: TileStateInput, members: TileMember[], wanted: (event: PrEvent) => boolean): UnreadReason[] {
  const reasons: UnreadReason[] = [];
  for (const member of members) {
    for (const event of input.events.get(member.prKey) ?? []) {
      if (!wanted(event)) {
        continue;
      }
      reasons.push({
        prKey: member.prKey,
        eventId: event.id,
        kind: event.kind,
        actor: event.actor,
        summary: event.summary,
        at: event.at,
      });
    }
  }
  return reasons.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

function unreadReasons(input: TileStateInput): UnreadReason[] {
  return reasonsWhere(input, input.tile.members.filter((m) => m.provenance.kind !== 'found'), isUnseenLoud);
}

/** Merges without the user's review they have not seen, on PRs the glance did not call not theirs. */
function unseenMergeReasons(input: TileStateInput): UnreadReason[] {
  const members = input.tile.members.filter((m) => isTracked(m.provenance) && !input.notYours?.has(m.prKey));
  return reasonsWhere(input, members, isUnseenMergeWithoutReview);
}

/**
 * A tile is snoozed while every tracked PR in it has an active snooze. A PR
 * that joins it unsnoozed, or whose snooze broke or ended, shows the tile.
 */
function isTileSnoozed(input: TileStateInput): boolean {
  const tracked = input.tile.members.filter((member) => isTracked(member.provenance));
  if (tracked.length === 0) {
    return false;
  }
  return tracked.every((member) => {
    const snooze = input.snoozes.get(member.prKey);
    const pr = input.prs.get(member.prKey);
    if (!snooze || !pr) {
      return false;
    }
    const context = { pr, events: input.events.get(member.prKey) ?? [], now: input.now, viewer: input.viewer ?? null };
    return snoozePhase(snooze, context) === 'active';
  });
}

function allPingedDone(input: TileStateInput): boolean {
  return input.tile.members.filter((m) => isTracked(m.provenance)).every((member) => {
    const pr = input.prs.get(member.prKey);
    if (!pr) {
      return false;
    }
    return isPrDone(pr, input.userStates.get(member.prKey) ?? null, input.viewer ?? null, input.events.get(member.prKey) ?? [], input.notYours?.has(member.prKey) ?? false);
  });
}

/**
 * snoozed: every tracked PR has a snooze whose condition is not met and that
 * no human broke with a loud event since it started.
 * unread: some member has an unseen loud event; unreadBecause says which.
 * done: every pinged member is done and nothing loud is unseen.
 * open: everything else.
 */
export function deriveTileState(input: TileStateInput): TileState {
  if (isTileSnoozed(input)) {
    return { kind: 'snoozed', unreadBecause: [] };
  }
  const reasons = unreadReasons(input);
  if (reasons.length > 0) {
    return { kind: 'unread', unreadBecause: reasons };
  }
  if (allPingedDone(input)) {
    return { kind: 'done', unreadBecause: [] };
  }
  const unseenMerges = unseenMergeReasons(input);
  return unseenMerges.length > 0 ? { kind: 'open', unreadBecause: [], unseenMerges } : { kind: 'open', unreadBecause: [] };
}

/** One line for the CLI and tooltips: why the tile is in its state. */
export function explainTileState(state: TileState): string {
  if (state.kind !== 'unread') {
    return state.kind;
  }
  const why = state.unreadBecause.map((reason) => `${reason.prKey}: ${reason.summary}`);
  return `unread (${why.join('; ')})`;
}

function memberFor(input: TopicTilesInput, prKey: PrKey, pulledInReason: string): TileMember {
  const thread = input.threads.get(prKey) ?? null;
  const events = input.events?.get(prKey) ?? [];
  return { prKey, provenance: provenanceFor(thread, pulledInReason, events, input.found?.get(prKey) ?? null) };
}

function prTitle(input: TopicTilesInput, prKey: PrKey): string {
  return input.prs.get(prKey)?.title ?? prKey;
}

function tileStack(stack: Stack): TileStack {
  return { id: stack.id, prKeys: [...stack.prKeys] };
}

function stackTile(input: TopicTilesInput, stack: Stack): Tile {
  return {
    id: stack.id,
    topicId: input.topicId,
    kind: 'stack',
    title: `${prTitle(input, stack.prKeys[0]!)} (stack of ${stack.prKeys.length})`,
    members: stack.prKeys.map((key) => memberFor(input, key, input.pullInReasons?.get(key) ?? 'stack layer')),
    stacks: [tileStack(stack)],
  };
}

/** Stacks that show in this topic, and the layers of stacks that show in another one. */
function placeStacks(input: TopicTilesInput, memberKeys: Set<PrKey>): { here: Stack[]; away: Set<PrKey> } {
  const here: Stack[] = [];
  const away = new Set<PrKey>();
  for (const stack of input.stacks) {
    const home = input.stackTopicIds?.get(stack.id);
    const shows = home === undefined ? stack.prKeys.some((key) => memberKeys.has(key)) : home === input.topicId;
    if (shows) {
      here.push(stack);
    } else {
      stack.prKeys.forEach((key) => away.add(key));
    }
  }
  return { here, away };
}

/**
 * A set member that is a stack layer brings its whole stack along, in stack
 * order, so a set never tears a layer out of its stack. The tile lists those
 * stacks in `stacks`, so the stack still reads as one inside the set. A stack joins one
 * set at most (`taken`, by stack id), and layers of a stack shown in another
 * topic are left out. A set that would be one stack and nothing else is
 * just that stack: returns null then, and takes no stack.
 */
function setTile(input: TopicTilesInput, set: PrSet, stacks: Map<PrKey, Stack>, away: Set<PrKey>, taken: Map<string, string>): Tile | null {
  const members: TileMember[] = [];
  const seen = new Set<PrKey>();
  const units = new Set<string>();
  const joined: Stack[] = [];
  for (const member of set.members) {
    if (away.has(member.prKey) || seen.has(member.prKey)) {
      continue;
    }
    const stack = stacks.get(member.prKey);
    if (!stack) {
      seen.add(member.prKey);
      units.add(member.prKey);
      members.push(memberFor(input, member.prKey, member.reason));
      continue;
    }
    if ((taken.get(stack.id) ?? set.id) !== set.id) {
      continue;
    }
    units.add(stack.id);
    joined.push(stack);
    for (const key of stack.prKeys) {
      if (!seen.has(key)) {
        seen.add(key);
        const reason = key === member.prKey ? member.reason : (input.pullInReasons?.get(key) ?? 'stack layer');
        members.push(memberFor(input, key, reason));
      }
    }
  }
  if (members.length === 0 || (units.size < 2 && joined.length > 0)) {
    return null;
  }
  joined.forEach((stack) => taken.set(stack.id, set.id));
  return { id: setTileId(set.id), topicId: input.topicId, kind: 'set', title: set.title, members, stacks: joined.map(tileStack) };
}

function setTiles(input: TopicTilesInput, here: Stack[], away: Set<PrKey>, taken: Map<string, string>): Tile[] {
  const stacks = stackByPrKey(here);
  const tiles: Tile[] = [];
  for (const set of input.sets) {
    if (set.status !== 'active' || set.members.length === 0) {
      continue;
    }
    const tile = setTile(input, set, stacks, away, taken);
    if (tile) {
      tiles.push(tile);
    }
  }
  return tiles;
}

/**
 * Builds the tiles of one topic. Stacks come first, then sets, then a single
 * tile for every topic PR that is in neither. A stack is one unit: it shows
 * in one topic only (see `stackTopicIds`), whole and in order, either as its
 * own tile or inside one set tile, never split across tiles. Tiles without
 * a pinged or found member are dropped.
 */
export function buildTopicTiles(input: TopicTilesInput): Tile[] {
  const memberKeys = new Set(input.memberKeys);
  const { here, away } = placeStacks(input, memberKeys);
  const taken = new Map<string, string>();
  const sets = setTiles(input, here, away, taken);
  const stacks = here.filter((stack) => !taken.has(stack.id)).map((stack) => stackTile(input, stack));
  const grouped = [...stacks, ...sets];
  const covered = new Set(grouped.flatMap((tile) => tile.members.map((m) => m.prKey)));
  const singles: Tile[] = input.memberKeys
    .filter((key) => !covered.has(key) && !away.has(key))
    .map((key) => ({
      id: singleTileId(key),
      topicId: input.topicId,
      kind: 'single',
      title: prTitle(input, key),
      members: [memberFor(input, key, 'in this topic')],
      stacks: [],
    }));
  return [...grouped, ...singles].filter((tile) => tile.members.some((m) => isTracked(m.provenance)));
}
