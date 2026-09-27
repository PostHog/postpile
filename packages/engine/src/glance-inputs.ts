import type { GlanceInput, PromptContext } from '@code-manager/agent';
import { isPinged, TILE_STATE_ORDER, type PrKey, type Provenance, type Viewer } from '@code-manager/core';
import type { Store } from '@code-manager/store';
import type { Board } from './board.ts';
import type { PromptContextSource } from './prompt-context.ts';

/** Open PRs in tiles, most urgent tile first. A PR pinged anywhere counts as pinged. */
function glanceProvenances(board: Board): Map<PrKey, Provenance> {
  const tiles = board
    .allTiles()
    .map((tile) => ({ tile, priority: TILE_STATE_ORDER[board.stateOf(tile).kind] }))
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

/**
 * The glance input for every PR that should have a glance, most urgent first.
 * Shared by the glance job (what to generate) and the read models (whether a
 * stored glance still matches), so both hash exactly the same input.
 */
export function glanceInputs(
  board: Board,
  store: Store,
  viewer: Viewer,
  contexts: PromptContextSource,
): Map<PrKey, GlanceInput> {
  // One context per topic: forTopic reads the instructions file each time.
  const contextByTopic = new Map<string | null, PromptContext>();
  const contextFor = (topicId: string | null): PromptContext => {
    let context = contextByTopic.get(topicId);
    if (!context) {
      context = contexts.forTopic(topicId);
      contextByTopic.set(topicId, context);
    }
    return context;
  };

  const result = new Map<PrKey, GlanceInput>();
  for (const [key, provenance] of glanceProvenances(board)) {
    const pr = board.prs.get(key);
    if (!pr) {
      continue;
    }
    const topicId = board.memberships.get(key)?.topicId ?? null;
    const topic = topicId === null ? null : store.topics.get(topicId);
    result.set(key, { pr, viewer, provenance, topic, context: contextFor(topic?.id ?? null) });
  }
  return result;
}
