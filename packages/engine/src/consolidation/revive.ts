import { effectiveLoudness } from '@postpile/core';
import type { Store } from '@postpile/store';
import { prKeyOfEvent } from '../ids.ts';
import { changeTopicStatus } from '../topic-status.ts';

/**
 * Retiring is reversible: a retired topic comes back when one of its PRs gets
 * a new loud event, so a late mention on a merged PR is never hidden. Loud
 * as the agent left it (`effectiveLoudness`): the sync runs this after the
 * new events are classified, so an event the agent turned quiet brings
 * nothing back. Returns how many topics came back.
 */
export function reviveRetiredTopics(store: Store, newEventIds: string[], at: string): number {
  const wanted = new Set(newEventIds);
  const keys = [...new Set(newEventIds.map(prKeyOfEvent))];
  const topicIds = new Set<string>();
  for (const [key, events] of store.events.listForPrs(keys)) {
    const loud = events.some((e) => wanted.has(e.id) && effectiveLoudness(e) === 'loud' && e.seenAt === null);
    const topicId = store.memberships.get(key)?.topicId;
    if (loud && topicId) {
      topicIds.add(topicId);
    }
  }
  let revived = 0;
  store.transaction(() => {
    for (const topicId of topicIds) {
      if (changeTopicStatus(store, topicId, 'revive', at)) {
        revived += 1;
      }
    }
  });
  return revived;
}
