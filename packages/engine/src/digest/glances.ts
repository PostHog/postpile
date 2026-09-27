import type { GlanceInput } from '@code-manager/agent';
import { isPinged, type PrKey, type Provenance, type TileStateKind } from '@code-manager/core';
import { Board } from '../board.ts';
import { errorText, type DigestDeps } from './deps.ts';

const statePriority: Record<TileStateKind, number> = { unread: 0, open: 1, snoozed: 2, done: 3 };

/**
 * One glance per open PR that shows up in a tile. The input hash decides
 * whether the stored glance is still good; unread tiles go first so a small
 * budget is spent where the user looks first.
 */
export class GlanceWriter {
  constructor(private readonly deps: DigestDeps) {}

  /** Open PRs in tiles, most urgent tile first. A PR pinged anywhere counts as pinged. */
  private wanted(board: Board): Map<PrKey, Provenance> {
    const tiles = board
      .allTiles()
      .map((tile) => ({ tile, priority: statePriority[board.stateOf(tile).kind] }))
      .sort((a, b) => a.priority - b.priority);
    const result = new Map<PrKey, Provenance>();
    for (const { tile } of tiles) {
      for (const member of tile.members) {
        if (board.prs.get(member.prKey)?.state !== 'OPEN') {
          continue;
        }
        const known = result.get(member.prKey);
        if (!known || (!isPinged(known) && isPinged(member.provenance))) {
          result.set(member.prKey, member.provenance);
        }
      }
    }
    return result;
  }

  private input(board: Board, key: PrKey, provenance: Provenance): GlanceInput | null {
    const pr = board.prs.get(key);
    if (!pr) {
      return null;
    }
    const topicId = board.memberships.get(key)?.topicId ?? null;
    const topic = topicId === null ? null : this.deps.store.topics.get(topicId);
    return { pr, viewer: this.deps.viewer, provenance, topic, context: this.deps.contexts.forTopic(topic?.id ?? null) };
  }

  private async glance(input: GlanceInput): Promise<void> {
    const { store, agent } = this.deps;
    if (store.glances.get(input.pr.key)?.inputHash === agent.glanceInputHash(input) || !this.deps.budget.take()) {
      return;
    }
    try {
      store.glances.put(await agent.glance(input));
    } catch (error) {
      this.deps.errors.push(`glance ${input.pr.key}: ${errorText(error)}`);
    }
  }

  async run(): Promise<void> {
    const board = Board.load(this.deps.store, this.deps.now().toISOString());
    const inputs: GlanceInput[] = [];
    for (const [key, provenance] of this.wanted(board)) {
      const input = this.input(board, key, provenance);
      if (input) {
        inputs.push(input);
      }
    }
    // The runner caps concurrency; budget.take is synchronous so the cap holds.
    await Promise.all(inputs.map((input) => this.glance(input)));
  }
}
