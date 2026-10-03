import type { AgentService, GlanceBatchInput, GlanceBatchItem, PromptContext } from '@postpile/agent';
import {
  isTracked,
  isUnseenMergeWithoutReview,
  TILE_STATE_ORDER,
  withoutStaleClaims,
  type DossierVersion,
  type Pr,
  type PrEvent,
  type PrKey,
  type Topic,
  type Viewer,
} from '@postpile/core';
import type { Store } from '@postpile/store';
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
 * Open pinged and found PRs in tiles, most urgent tile first. Pulled-in stack layers
 * get no glance: they are context for the pinged PR, not work of their own.
 */
/**
 * Open PRs, and merged ones while a merge without the user's review is
 * unseen: the glance then answers "worth a look after the fact?" (DESIGN
 * "Merged without your review").
 */
function wantsGlance(pr: Pr, events: PrEvent[]): boolean {
  return pr.state === 'OPEN' || (pr.state === 'MERGED' && events.some(isUnseenMergeWithoutReview));
}

function itemsByUrgency(board: Board): Map<PrKey, GlanceBatchItem> {
  const tiles = board
    .allTiles()
    .map((tile) => ({ tile, priority: TILE_STATE_ORDER[board.stateOf(tile).kind] }))
    .sort((a, b) => a.priority - b.priority);
  const result = new Map<PrKey, GlanceBatchItem>();
  for (const { tile } of tiles) {
    for (const member of tile.members) {
      const pr = board.prs.get(member.prKey);
      if (!pr || !isTracked(member.provenance) || result.has(member.prKey) || !wantsGlance(pr, board.events.get(pr.key) ?? [])) {
        continue;
      }
      result.set(member.prKey, { pr, provenance: member.provenance });
    }
  }
  return result;
}

/** PRs that should have a glance (open, pinged or found, in a tile), for the read models' glance state. */
export function glanceTargetKeys(board: Board): Set<PrKey> {
  return new Set(itemsByUrgency(board).keys());
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

/**
 * PRs the next glance job would call the agent for: targets whose stored
 * glance is missing or no longer matches its input (the glance writer's own
 * check, with the dossier as it is now). The inbox catch-up's saving line
 * counts them.
 */
export function pendingGlanceKeys(store: Store, board: Board, viewer: Viewer, contexts: PromptContextSource, agent: AgentService): Set<PrKey> {
  const inputs = new GlanceInputs(store, board, viewer, contexts);
  const targets = inputs.targets();
  const stored = store.glances.getMany(targets.map((target) => target.item.pr.key));
  return new Set(targets.filter((target) => stored.get(target.item.pr.key)?.inputHash !== inputs.itemHash(agent, target)).map((target) => target.item.pr.key));
}
