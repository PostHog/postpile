import { newTopic, nextTopicStatus, setIdFromTileId, singleTileId, type PrKey, type Tile, type TileStack, type Topic } from '@postpile/core';
import { UNSORTED_TOPIC_ID } from '@postpile/engine';
import type { SampleData } from './sample-data.ts';

/** Same words as the engine's Board for its Unsorted topic. */
function unsortedTopic(at: string): Topic {
  return { ...newTopic(UNSORTED_TOPIC_ID, 'Unsorted', at), summary: 'Waiting for the agent. Each sync places these in a topic.' };
}

/** Stacks count as one unit each, like the engine's setUnitCount. */
function unitCount(tile: Tile): number {
  const inStacks = new Set(tile.stacks.flatMap((stack) => stack.prKeys));
  return tile.stacks.length + tile.members.filter((member) => !inStacks.has(member.prKey)).length;
}

/**
 * "Wrong topic" and "Not related" over the sample tiles, the way the engine's
 * FeedbackActions changes memberships and sets and the next tile build shows
 * it (DESIGN.md › Stacks as one unit). A move takes the PR plus its stack,
 * never its set. A PR that leaves a set shows as its own tile; a set left with
 * fewer than two units ends, and its last unit stands alone.
 */
export class FakeTileFeedback {
  constructor(
    private readonly data: SampleData,
    private readonly now: () => Date,
  ) {}

  private stackOf(tile: Tile, key: PrKey): TileStack | undefined {
    return tile.stacks.find((stack) => stack.prKeys.includes(key));
  }

  private titleOf(key: PrKey): string {
    return this.data.prs.find((pr) => pr.key === key)?.title ?? key;
  }

  /** Like Board.movesWith: the PR and its stack's layers, which change topic together. */
  movesWith(tile: Tile, key: PrKey): PrKey[] {
    return this.stackOf(tile, key)?.prKeys ?? [key];
  }

  /** The tile these PRs make on their own: their stack's tile, or a single. */
  private unitTile(tile: Tile, keys: PrKey[], topicId: string): Tile {
    const members = tile.members.filter((member) => keys.includes(member.prKey));
    const stack = this.stackOf(tile, keys[0]!);
    if (stack) {
      const title = `${this.titleOf(stack.prKeys[0]!)} (stack of ${stack.prKeys.length})`;
      return { id: stack.id, topicId, kind: 'stack', title, members, stacks: [stack] };
    }
    return { id: singleTileId(keys[0]!), topicId, kind: 'single', title: this.titleOf(keys[0]!), members, stacks: [] };
  }

  private replaceTile(tile: Tile, next: Tile[]): void {
    const index = this.data.tiles.indexOf(tile);
    this.data.tiles.splice(index, 1, ...next);
  }

  /** The sample set behind the tile loses the PRs too, and ends with fewer than two units, like the store's set. */
  private leaveSampleSet(tile: Tile, keys: PrKey[]): void {
    const set = this.data.sets.find((candidate) => candidate.id === setIdFromTileId(tile.id));
    if (!set) {
      return;
    }
    set.members = set.members.filter((member) => !keys.includes(member.prKey));
    set.updatedAt = this.now().toISOString();
    if (unitCount(tile) < 2) {
      set.status = 'dissolved';
    }
  }

  /** Takes the PRs out of a set tile and puts their own tile in topicId. */
  private splitFromSet(tile: Tile, keys: PrKey[], topicId: string): void {
    const unit = this.unitTile(tile, keys, topicId);
    tile.members = tile.members.filter((member) => !keys.includes(member.prKey));
    tile.stacks = tile.stacks.filter((stack) => !stack.prKeys.some((key) => keys.includes(key)));
    this.leaveSampleSet(tile, keys);
    if (tile.members.length === 0) {
      this.replaceTile(tile, [unit]);
      return;
    }
    if (unitCount(tile) < 2) {
      const rest = tile.members.map((member) => member.prKey);
      this.replaceTile(tile, [this.unitTile(tile, rest, tile.topicId), unit]);
      return;
    }
    this.data.tiles.push(unit);
  }

  private topicFor(topicId: string): Topic | null {
    const at = this.now().toISOString();
    if (topicId === UNSORTED_TOPIC_ID) {
      const unsorted = this.data.topics.find((topic) => topic.id === UNSORTED_TOPIC_ID);
      if (unsorted) {
        return unsorted;
      }
      const created = unsortedTopic(at);
      this.data.topics.push(created);
      return created;
    }
    return this.data.topics.find((topic) => topic.id === topicId) ?? null;
  }

  /**
   * Moves the PRs to topicId (UNSORTED_TOPIC_ID when the user did not say
   * where, so the next sync re-sorts them). A retired target comes back, like
   * the engine's revive. Returns false when the topic does not exist.
   */
  move(tile: Tile, keys: PrKey[], topicId: string): boolean {
    const target = this.topicFor(topicId);
    if (!target) {
      return false;
    }
    const at = this.now().toISOString();
    const revived = nextTopicStatus(target, 'revive', at);
    if (revived) {
      Object.assign(target, revived, { updatedAt: at });
    }
    for (const key of keys) {
      if (topicId === UNSORTED_TOPIC_ID) {
        this.data.membership.delete(key);
      } else {
        this.data.membership.set(key, topicId);
      }
    }
    if (tile.kind === 'set') {
      this.splitFromSet(tile, keys, topicId);
    } else {
      tile.topicId = topicId;
    }
    return true;
  }

  /** "Not related": the PR (with its stack) leaves the set and stays in the topic as its own tile. */
  leaveSet(tile: Tile, key: PrKey): void {
    const keys = this.movesWith(tile, key);
    this.data.sets.find((set) => set.id === setIdFromTileId(tile.id))?.removedKeys.push(...keys);
    this.splitFromSet(tile, keys, tile.topicId);
  }
}
