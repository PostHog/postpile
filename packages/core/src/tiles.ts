import { isUnseenLoud } from './loudness.ts';
import { sameLogin } from './mentions.ts';
import { isPinged, provenanceFor } from './provenance.ts';
import { breaksSnooze, isSnoozeOver } from './snooze.ts';
import type {
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
  TileState,
  TileStateKind,
  UnreadReason,
  UserPrState,
} from './types.ts';

export interface TileStateInput {
  tile: Tile;
  prs: Map<PrKey, Pr>;
  events: Map<PrKey, PrEvent[]>;
  userStates: Map<PrKey, UserPrState>;
  snooze: Snooze | null;
  now: IsoTime;
  /** Lets an approval made on github.com count as done, not only ones made in the app. */
  viewerLogin?: string;
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
  /** Active sets of this topic. */
  sets: PrSet[];
  events?: Map<PrKey, PrEvent[]>;
}

/** Most urgent first. Used to sort tiles for display and for the glance budget. */
export const TILE_STATE_ORDER: Record<TileStateKind, number> = { unread: 0, open: 1, snoozed: 2, done: 3 };

export function singleTileId(prKey: PrKey): string {
  return `pr:${prKey}`;
}

export function setTileId(setId: string): string {
  return `set:${setId}`;
}

function approvedHeadOnGitHub(pr: Pr, viewerLogin: string | undefined): boolean {
  if (viewerLogin === undefined) {
    return false;
  }
  return pr.reviews.some(
    (r) => r.state === 'APPROVED' && sameLogin(r.author, viewerLogin) && r.commitOid === pr.headOid,
  );
}

/**
 * A pinged PR is done once it is merged/closed, the user handled it, or the
 * user approved its current head. A push after approval makes it not done.
 */
export function isPrDone(pr: Pr, userState: UserPrState | null, viewerLogin?: string): boolean {
  if (pr.state !== 'OPEN') {
    return true;
  }
  if (userState?.handledAt) {
    return true;
  }
  if (userState?.approvedAt) {
    const oid = userState.approvedCommitOid;
    if (oid === null || oid === pr.headOid) {
      return true;
    }
  }
  return approvedHeadOnGitHub(pr, viewerLogin);
}

function unreadReasons(input: TileStateInput): UnreadReason[] {
  const reasons: { at: IsoTime; reason: UnreadReason }[] = [];
  for (const member of input.tile.members) {
    for (const event of input.events.get(member.prKey) ?? []) {
      if (!isUnseenLoud(event)) {
        continue;
      }
      reasons.push({
        at: event.at,
        reason: { prKey: member.prKey, eventId: event.id, kind: event.kind, summary: event.summary },
      });
    }
  }
  reasons.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return reasons.map((entry) => entry.reason);
}

function isSnoozeActive(input: TileStateInput): boolean {
  const snooze = input.snooze;
  if (!snooze) {
    return false;
  }
  const memberKeys = input.tile.members.map((m) => m.prKey);
  const prs = memberKeys.map((key) => input.prs.get(key)).filter((pr): pr is Pr => pr !== undefined);
  const events = memberKeys.flatMap((key) => input.events.get(key) ?? []);
  if (events.some((event) => breaksSnooze(event, snooze))) {
    return false;
  }
  return !isSnoozeOver(snooze, { prs, events, now: input.now, viewerLogin: input.viewerLogin });
}

function allPingedDone(input: TileStateInput): boolean {
  return input.tile.members.filter((m) => isPinged(m.provenance)).every((member) => {
    const pr = input.prs.get(member.prKey);
    if (!pr) {
      return false;
    }
    return isPrDone(pr, input.userStates.get(member.prKey) ?? null, input.viewerLogin);
  });
}

/**
 * snoozed: a snooze is active, its condition is not met, and no human made a
 * loud event since it started.
 * unread: some member has an unseen loud event; unreadBecause says which.
 * done: every pinged member is done and nothing loud is unseen.
 * open: everything else.
 */
export function deriveTileState(input: TileStateInput): TileState {
  if (isSnoozeActive(input)) {
    return { kind: 'snoozed', unreadBecause: [] };
  }
  const reasons = unreadReasons(input);
  if (reasons.length > 0) {
    return { kind: 'unread', unreadBecause: reasons };
  }
  if (allPingedDone(input)) {
    return { kind: 'done', unreadBecause: [] };
  }
  return { kind: 'open', unreadBecause: [] };
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
  return { prKey, provenance: provenanceFor(thread, pulledInReason, events) };
}

function prTitle(input: TopicTilesInput, prKey: PrKey): string {
  return input.prs.get(prKey)?.title ?? prKey;
}

function stackTiles(input: TopicTilesInput, memberKeys: Set<PrKey>): Tile[] {
  const tiles: Tile[] = [];
  for (const stack of input.stacks) {
    if (!stack.prKeys.some((key) => memberKeys.has(key))) {
      continue;
    }
    tiles.push({
      id: stack.id,
      topicId: input.topicId,
      kind: 'stack',
      title: `${prTitle(input, stack.prKeys[0]!)} (stack of ${stack.prKeys.length})`,
      members: stack.prKeys.map((key) => memberFor(input, key, 'part of the stack')),
    });
  }
  return tiles;
}

function setTiles(input: TopicTilesInput): Tile[] {
  return input.sets
    .filter((set) => set.status === 'active' && set.members.length > 0)
    .map((set) => ({
      id: setTileId(set.id),
      topicId: input.topicId,
      kind: 'set' as const,
      title: set.title,
      members: set.members.map((member) => memberFor(input, member.prKey, member.reason)),
    }));
}

/**
 * Builds the tiles of one topic. Stacks come first, then sets, then a single
 * tile for every topic PR that is in neither. A PR can be in a stack and a
 * set at once. Tiles without a pinged member are dropped.
 */
export function buildTopicTiles(input: TopicTilesInput): Tile[] {
  const memberKeys = new Set(input.memberKeys);
  const grouped = [...stackTiles(input, memberKeys), ...setTiles(input)];
  const covered = new Set(grouped.flatMap((tile) => tile.members.map((m) => m.prKey)));
  const singles: Tile[] = input.memberKeys
    .filter((key) => !covered.has(key))
    .map((key) => ({
      id: singleTileId(key),
      topicId: input.topicId,
      kind: 'single',
      title: prTitle(input, key),
      members: [memberFor(input, key, 'in this topic')],
    }));
  return [...grouped, ...singles].filter((tile) => tile.members.some((m) => isPinged(m.provenance)));
}
