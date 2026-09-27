import type { Store } from '@code-manager/store';
import { prKeyOfEvent } from '../ids.ts';

/**
 * Retiring is reversible: a retired topic comes back when one of its PRs gets
 * a new loud event, so a late mention on a merged PR is never hidden.
 * Returns how many topics came back.
 */
export function reviveRetiredTopics(store: Store, newEventIds: string[], at: string): number {
  const wanted = new Set(newEventIds);
  const keys = [...new Set(newEventIds.map(prKeyOfEvent))];
  const topicIds = new Set<string>();
  for (const [key, events] of store.events.listForPrs(keys)) {
    const loud = events.some((e) => wanted.has(e.id) && e.ruleLoudness === 'loud' && e.seenAt === null);
    const topicId = store.memberships.get(key)?.topicId;
    if (loud && topicId && store.topics.get(topicId)?.status === 'retired') {
      topicIds.add(topicId);
    }
  }
  store.transaction(() => {
    for (const topicId of topicIds) {
      store.topics.setStatus(topicId, 'active', at);
    }
  });
  return topicIds.size;
}
