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

/**
 * A finished topic never holds an unread thread (DESIGN.md "GitHub unread is
 * PostPile unread"): every retired topic with a member PR whose thread is
 * unread on GitHub becomes active again, whether the thread just turned
 * unread or was unread when the topic retired (before 2026-09-30 the retire
 * gate did not look at threads). Runs after the quiet reads in the full
 * sync, so what PostPile clears by itself brings nothing back, and in every
 * poll that moved the inbox. Returns how many topics came back.
 */
export function reviveUnreadTopics(store: Store, at: string): number {
  const retired = store.topics.list().filter((topic) => topic.status === 'retired');
  if (retired.length === 0) {
    return 0;
  }
  let revived = 0;
  store.transaction(() => {
    for (const topic of retired) {
      const keys = store.memberships.listForTopic(topic.id).map((membership) => membership.prKey);
      const unread = [...store.notifications.getByPrKeys(keys).values()].some((thread) => thread.unread);
      if (unread && changeTopicStatus(store, topic.id, 'revive', at)) {
        revived += 1;
      }
    }
  });
  return revived;
}
