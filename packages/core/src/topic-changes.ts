import type { Cursor, DossierVersion, Fact } from './memory.ts';
import type { TopicChanges } from './memory-views.ts';

/**
 * "What changed since the user last looked": the recentChanges entries newer
 * than the seen cursor, facts recorded or closed after it, and how many events
 * arrived. Null when the topic was never marked seen (everything is new).
 * A fact both added and closed since then only counts as closed.
 */
export function topicChangesSince(
  seen: Cursor | null,
  latest: DossierVersion,
  facts: Fact[],
  newEventCount: number,
): TopicChanges | null {
  if (seen === null) {
    return null;
  }
  const since = seen.updatedAt;
  const changes = latest.dossier.recentChanges
    .filter((change) => change.at > since)
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return {
    since,
    fromVersion: seen.dossierVersion,
    changes,
    factsAdded: facts.filter((fact) => fact.recordedAt > since && fact.expiredAt === null),
    factsClosed: facts.filter((fact) => fact.expiredAt !== null && fact.expiredAt > since),
    newEvents: newEventCount,
  };
}
