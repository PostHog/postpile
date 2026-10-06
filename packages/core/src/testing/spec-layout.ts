// The topic's tiles as the recipe says they should be (DESIGN "Stacks as one
// unit", "Topic placement", "Snoozes belong to PRs"): which tile each PR
// lands in, in which order, with which provenance, and which PRs a snooze
// covers. Worked out from the groups of the recipe and the PR states, not
// from `buildTopicTiles`, `provenanceFor` or `snoozeWrites`.
import type { PingReason, PrKey, Provenance, SnoozeCondition } from '../types.ts';
import type { GroupKind } from './board-spec.ts';
import type { PropertyBoard } from './build-board.ts';

export interface ExpectedMember {
  prKey: PrKey;
  provenance: Provenance;
}

export interface ExpectedTile {
  id: string;
  kind: 'single' | 'stack' | 'set';
  members: ExpectedMember[];
  stacks: { id: string; prKeys: PrKey[] }[];
}

/** The PR has a notification thread or the full sync found it: it is in the topic on its own account. */
function inTopic(board: PropertyBoard, key: PrKey): boolean {
  return board.threads.has(key) || board.found.has(key);
}

/**
 * A PR without a thread that GitHub notified about all the same: the first
 * of its events (store order) that is a person's mention, question or team
 * mention, or a review request loud by rule (one that asks the viewer or
 * their team, whoever clicked it).
 */
function pingFromEvents(board: PropertyBoard, key: PrKey): PingReason | null {
  for (const event of board.events.get(key) ?? []) {
    const byPerson = !event.isBot && event.actor !== '';
    if ((event.kind === 'mention' || event.kind === 'question_to_user') && byPerson) {
      return 'mention';
    }
    if (event.kind === 'team_mention' && byPerson) {
      return 'team_mention';
    }
    if (event.kind === 'review_requested' && event.ruleLoudness === 'loud') {
      return 'review_requested';
    }
  }
  return null;
}

/** Pinged by its thread, found by the sync, pinged by its events, else pulled in for `reason`. */
export function expectedProvenance(board: PropertyBoard, key: PrKey, reason: string): Provenance {
  const thread = board.threads.get(key);
  if (thread) {
    return { kind: 'pinged', reason: thread.reason };
  }
  const found = board.found.get(key);
  if (found) {
    return { kind: 'found', via: found.via, reason: found.reason };
  }
  const ping = pingFromEvents(board, key);
  return ping ? { kind: 'pinged', reason: ping } : { kind: 'pulled_in', reason };
}

function prNumber(key: PrKey): number {
  return Number(key.slice(key.lastIndexOf('#') + 1));
}

/** What the sync says when it pulls in a stack layer. */
function layerReason(key: PrKey): string {
  return `stack layer below #${prNumber(key) + 1}`;
}

/** The layers of the group's stack: every PR of a stack group, the first two of a set with a stack. */
function stackLayers(kind: GroupKind, keys: PrKey[]): PrKey[] {
  if (kind === 'stack') {
    return keys;
  }
  return kind === 'set_with_stack' ? keys.slice(0, 2) : [];
}

/** A real stack: two layers or more, one of them open. */
function isStack(board: PropertyBoard, layers: PrKey[]): boolean {
  return layers.length >= 2 && layers.some((key) => board.fullPrs.get(key)?.state === 'OPEN');
}

function stackTile(board: PropertyBoard, layers: PrKey[]): ExpectedTile {
  const id = `stack:${layers[0]!}`;
  return {
    id,
    kind: 'stack',
    members: layers.map((key) => ({ prKey: key, provenance: expectedProvenance(board, key, layerReason(key)) })),
    stacks: [{ id, prKeys: layers }],
  };
}

function isTrackedMember(member: ExpectedMember): boolean {
  return member.provenance.kind !== 'pulled_in';
}

/** A set's members, in order; a listed stack layer brings its whole stack, base to head. */
function setMembers(board: PropertyBoard, listed: PrKey[], stack: PrKey[]): ExpectedMember[] {
  const members: ExpectedMember[] = [];
  for (const key of listed) {
    if (!stack.includes(key)) {
      members.push({ prKey: key, provenance: expectedProvenance(board, key, 'same change') });
    } else if (!members.some((member) => member.prKey === stack[0])) {
      members.push(...stack.map((layer) => ({ prKey: layer, provenance: expectedProvenance(board, layer, layer === key ? 'same change' : layerReason(layer)) })));
    }
  }
  return members;
}

/**
 * The tiles, in order: stacks, then sets, then one single tile per other
 * PR in the topic; a tile without a pinged or found PR is dropped. A stack
 * shows only while one of its layers is in the topic, always whole and base
 * to head; the layers of a stack that does not show stay out of every tile.
 * A set that lists a stack layer brings the whole stack as one unit, and a
 * set that would be that stack alone is just the stack. A dissolved set is
 * nothing: its PRs show on their own.
 */
export function expectedTiles(board: PropertyBoard): ExpectedTile[] {
  const stacks: ExpectedTile[] = [];
  const sets: ExpectedTile[] = [];
  const covered = new Set<PrKey>();
  board.spec.groups.forEach((group, groupIndex) => {
    const keys = board.groupKeys[groupIndex]!;
    const layers = stackLayers(group.kind, keys);
    const stack = isStack(board, layers) ? layers : [];
    const stackShows = stack.some((key) => inTopic(board, key));
    stack.forEach((key) => covered.add(key));
    if (group.kind !== 'set' && group.kind !== 'set_with_stack') {
      if (stackShows) {
        stacks.push(stackTile(board, stack));
      }
      return;
    }
    // A set with a stack lists only the upper layer.
    const listed = group.kind === 'set_with_stack' ? keys.slice(1) : keys;
    const plain = listed.filter((key) => !stack.includes(key));
    plain.forEach((key) => covered.add(key));
    if (stackShows && plain.length === 0) {
      stacks.push(stackTile(board, stack));
      return;
    }
    const members = setMembers(board, listed.filter((key) => stackShows || !stack.includes(key)), stack);
    if (members.length > 0) {
      const joined = stackShows ? [{ id: `stack:${stack[0]!}`, prKeys: stack }] : [];
      sets.push({ id: `set:s${groupIndex}`, kind: 'set', members, stacks: joined });
    }
  });
  const singles: ExpectedTile[] = board.groupKeys
    .flat()
    .filter((key) => inTopic(board, key) && !covered.has(key))
    .map((key) => ({ id: `pr:${key}`, kind: 'single', members: [{ prKey: key, provenance: expectedProvenance(board, key, 'in this topic') }], stacks: [] }));
  return [...stacks, ...sets, ...singles].filter((tile) => tile.members.some(isTrackedMember));
}

/** The snooze each PR should carry: the whole tile's (one per tracked member), else its own while it is a tracked member of some tile. */
export function expectedSnoozes(board: PropertyBoard, tiles: ExpectedTile[]): Map<PrKey, SnoozeCondition['kind']> {
  const snoozes = new Map<PrKey, SnoozeCondition['kind']>();
  const tracked = new Set(tiles.flatMap((tile) => tile.members.filter(isTrackedMember).map((member) => member.prKey)));
  for (const key of board.groupKeys.flat()) {
    const snooze = board.prSpecs.get(key)?.snooze;
    if (snooze && tracked.has(key)) {
      snoozes.set(key, snooze.condition);
    }
  }
  board.spec.groups.forEach((group, groupIndex) => {
    const first = board.groupKeys[groupIndex]![0];
    const tile = tiles.find((candidate) => candidate.members.some((member) => member.prKey === first));
    if (group.snooze === null || tile === undefined) {
      return;
    }
    for (const member of tile.members.filter(isTrackedMember)) {
      snoozes.set(member.prKey, group.snooze.condition);
    }
  });
  return snoozes;
}
