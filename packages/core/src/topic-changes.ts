import type { Cursor, DossierVersion, Fact } from './memory.ts';
import type { TopicChanges } from './memory-views.ts';

/**
 * "What changed since the user last looked": the recentChanges entries newer
 * than the seen cursor, facts recorded or closed after it, and how many events
 * arrived. Null when the topic was never marked seen (everything is new).
 */
export function topicChangesSince(
  seen: Cursor | null,
  latest: DossierVersion,
  facts: Fact[],
  newEventCount: number,
): TopicChanges | null {
  throw new Error(`not implemented: topicChangesSince (${seen?.scope ?? 'never seen'}, v${latest.version}, ${facts.length}, ${newEventCount})`);
}
