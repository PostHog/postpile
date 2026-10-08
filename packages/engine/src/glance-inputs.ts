import type { AgentService, GlanceBatchInput, GlanceBatchItem, PromptContext } from '@postpile/agent';
import {
  declaredParentNote,
  isBotTalk,
  isTracked,
  prWantsGlance,
  prWhoseTurn,
  TILE_STATE_ORDER,
  withoutStaleClaims,
  type DossierVersion,
  type Glance,
  type Pr,
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

/** It is the viewer's move on this PR alone (`prWhoseTurn`); never before a viewer is stored. */
function isViewersMove(board: Board, pr: Pr): boolean {
  if (!board.viewer) {
    return false;
  }
  const turn = prWhoseTurn({
    pr,
    events: board.events.get(pr.key) ?? [],
    userState: board.userStates.get(pr.key) ?? null,
    viewer: board.viewer,
    notYours: board.notYours.has(pr.key),
  });
  return turn.kind === 'you';
}

/** Adds what the PR's diff owes the layer below its body declares, when its stack links it that way. */
function withDeclaredParent(board: Board, item: GlanceBatchItem): GlanceBatchItem {
  const parentKey = board.declaredParentKeyOf(item.pr.key);
  const parent = parentKey ? board.prs.get(parentKey) : undefined;
  return parent ? { ...item, declaredParent: declaredParentNote(item.pr, parent) } : item;
}

/**
 * Pinged and found PRs in tiles that want a glance (`prWantsGlance`): the
 * PRs where it is the viewer's move first, then the rest, each part most
 * urgent tile first. After a sync the glance job works in this order, so
 * a PR waiting on the user gets its glance before the others (2026-10-08).
 * Pulled-in stack layers get no glance: they are context for the pinged
 * PR, not work of their own.
 */
function itemsByUrgency(board: Board): Map<PrKey, GlanceBatchItem> {
  const tiles = board
    .allTiles()
    .map((tile) => ({ tile, priority: TILE_STATE_ORDER[board.stateOf(tile).kind] }))
    .sort((a, b) => a.priority - b.priority);
  const yours = new Map<PrKey, GlanceBatchItem>();
  const rest = new Map<PrKey, GlanceBatchItem>();
  for (const { tile } of tiles) {
    for (const member of tile.members) {
      const pr = board.prs.get(member.prKey);
      const seen = yours.has(member.prKey) || rest.has(member.prKey);
      if (!pr || !isTracked(member.provenance) || seen || !prWantsGlance(pr, board.events.get(pr.key) ?? [])) {
        continue;
      }
      const part = isViewersMove(board, pr) ? yours : rest;
      part.set(member.prKey, withDeclaredParent(board, { pr, provenance: member.provenance }));
    }
  }
  return new Map([...yours, ...rest]);
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

  /** The hash a glance written now carries. Never depends on the other PRs in a batch. */
  itemHash(agent: AgentService, target: GlanceTarget): string {
    return agent.glanceItemInputHash(this.batchInput(target.topicId, [target.item], 1), target.item);
  }

  /**
   * Whether a stored glance still matches its input. Never depends on the
   * other PRs in a batch. Older hash shapes still count, so updating the app
   * regenerates no glance:
   * - before 2026-10-06, bot talk counted as discussion: matched with the
   *   bot talk there was when the glance was written (DESIGN.md "Bot talk leaves agent work"
   *   › Glances written before)
   * - before 2026-10-05, with the dossier version (and bot talk the same
   *   way): counts while that dossier is the latest, unless a person edited
   *   a comment after the glance was written: that shape holds comment ids
   *   only, and the dossier version that used to cover an edit may never
   *   move (Unsorted).
   */
  isCurrent(agent: AgentService, target: GlanceTarget, stored: Pick<Glance, 'inputHash' | 'createdAt'> | null | undefined): boolean {
    if (!stored) {
      return false;
    }
    if (stored.inputHash === this.itemHash(agent, target)) {
      return true;
    }
    const input = this.batchInput(target.topicId, [target.item], 1);
    if (stored.inputHash === agent.glanceItemInputHashWithBotTalk(input, target.item, stored.createdAt)) {
      return true;
    }
    if (stored.inputHash !== agent.legacyGlanceItemInputHash(input, target.item, stored.createdAt)) {
      return false;
    }
    const pr = target.item.pr;
    return !pr.comments.some((comment) => !isBotTalk(comment, pr) && comment.lastEditedAt && comment.lastEditedAt > stored.createdAt);
  }

  /**
   * Written against an older dossier of its topic. Still current (the hash
   * leaves the version out), but a look at the PR rewrites it with the
   * newer dossier.
   */
  behindDossier(target: GlanceTarget, stored: Pick<Glance, 'dossierVersion'> | null | undefined): boolean {
    const latest = this.dossierVersion(target.topicId);
    return stored !== null && stored !== undefined && latest !== null && (stored.dossierVersion ?? 0) < latest;
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
  return new Set(targets.filter((target) => !inputs.isCurrent(agent, target, stored.get(target.item.pr.key))).map((target) => target.item.pr.key));
}
