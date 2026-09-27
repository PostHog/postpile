import type { AgentService, GlanceBatchInput, GlanceBatchItem, PromptContext } from '@code-manager/agent';
import {
  isPinged,
  TILE_STATE_ORDER,
  withoutStaleClaims,
  type DossierVersion,
  type PrKey,
  type Topic,
  type Viewer,
} from '@code-manager/core';
import type { Store } from '@code-manager/store';
import type { Board } from './board.ts';
import type { PromptContextSource } from './prompt-context.ts';

/** A PR that should have a glance, and the topic it sits in. */
export interface GlanceTarget {
  /** Null for the virtual Unsorted topic. */
  topicId: string | null;
  item: GlanceBatchItem;
}

interface TopicParts {
  topic: Topic | null;
  dossier: DossierVersion | null;
  context: PromptContext;
}

/**
 * Open pinged PRs in tiles, most urgent tile first. Pulled-in stack layers
 * get no glance: they are context for the pinged PR, not work of their own.
 */
function itemsByUrgency(board: Board): Map<PrKey, GlanceBatchItem> {
  const tiles = board
    .allTiles()
    .map((tile) => ({ tile, priority: TILE_STATE_ORDER[board.stateOf(tile).kind] }))
    .sort((a, b) => a.priority - b.priority);
  const result = new Map<PrKey, GlanceBatchItem>();
  for (const { tile } of tiles) {
    for (const member of tile.members) {
      const pr = board.prs.get(member.prKey);
      if (pr?.state !== 'OPEN' || !isPinged(member.provenance) || result.has(member.prKey)) {
        continue;
      }
      result.set(member.prKey, { pr, provenance: member.provenance });
    }
  }
  return result;
}

/**
 * Builds glance batch inputs the same way for the glance job (what to
 * generate) and the read models (whether a stored glance still matches), so
 * both hash exactly the same input. Topic, dossier and context are loaded
 * once per topic: forTopic reads the instructions file each time.
 */
export class GlanceInputs {
  private readonly parts = new Map<string | null, TopicParts>();

  constructor(
    private readonly store: Store,
    private readonly board: Board,
    private readonly viewer: Viewer,
    private readonly contexts: PromptContextSource,
  ) {}

  /**
   * The latest dossier without claims that fail verification, so a question
   * whose thread was resolved does not read as an open concern.
   */
  private checkedDossier(topicId: string): DossierVersion | null {
    const latest = this.store.dossiers.latest(topicId);
    if (!latest) {
      return null;
    }
    const members = [...this.board.memberships.values()].filter((m) => m.topicId === topicId);
    const world = { prs: this.board.prs, memberKeys: new Set(members.map((m) => m.prKey)), now: this.board.now };
    return { ...latest, dossier: withoutStaleClaims(latest.dossier, world) };
  }

  private partsFor(topicId: string | null): TopicParts {
    let parts = this.parts.get(topicId);
    if (!parts) {
      const topic = topicId === null ? null : this.store.topics.get(topicId);
      parts = {
        topic,
        dossier: topic ? this.checkedDossier(topic.id) : null,
        context: this.contexts.forTopic(topic?.id ?? null),
      };
      this.parts.set(topicId, parts);
    }
    return parts;
  }

  /** Every PR that should have a glance, most urgent first. */
  targets(): GlanceTarget[] {
    return [...itemsByUrgency(this.board)].map(([key, item]) => ({
      topicId: this.board.memberships.get(key)?.topicId ?? null,
      item,
    }));
  }

  dossierVersion(topicId: string | null): number | null {
    return this.partsFor(topicId).dossier?.version ?? null;
  }

  batchInput(topicId: string | null, items: GlanceBatchItem[], attempt: 1 | 2): GlanceBatchInput {
    const parts = this.partsFor(topicId);
    return { topic: parts.topic, dossier: parts.dossier, items, viewer: this.viewer, context: parts.context, attempt };
  }

  /** The hash a stored glance must carry to still be current. Never depends on the other PRs in a batch. */
  itemHash(agent: AgentService, target: GlanceTarget): string {
    return agent.glanceItemInputHash(this.batchInput(target.topicId, [target.item], 1), target.item);
  }
}
