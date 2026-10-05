import type { PrKey, PrState } from '@postpile/core';
import type { Store } from '@postpile/store';
import { Board } from '../board.ts';
import { threadsByPrKey } from '../hot-set.ts';
import { changeTopicStatus } from '../topic-status.ts';
import { RetireGate } from './retire-gate.ts';

/** The gate for one topic, on a Board that holds every PR of it (`Board.forTopic`): cold ones count too. */
export function topicRetireGate(store: Store, at: string, topicId: string): RetireGate {
  return new RetireGate(Board.forTopic(store, at, topicId));
}

/**
 * Could pass the gate at all, from short rows only: every member PR merged
 * or closed and none with a thread unread on GitHub. Only these topics get
 * a Board of their own, so the step does not read every cold PR each sync.
 */
function mayBeOver(memberKeys: PrKey[], states: Map<PrKey, PrState>, unread: Set<PrKey>): boolean {
  return memberKeys.length > 0 && memberKeys.every((key) => (states.get(key) === 'MERGED' || states.get(key) === 'CLOSED') && !unread.has(key));
}

/**
 * The sync's retire step, no agent verdict needed: every active topic that
 * passes the gate is retired. Runs after the digest, so events it just
 * stored count. Unsorted is no stored topic, so it never retires. Returns
 * how many topics retired.
 */
export function retireFinishedTopics(store: Store, at: string): number {
  const states = store.prs.stateByKey();
  const unread = new Set([...threadsByPrKey(store.notifications.list())].filter(([, thread]) => thread.unread).map(([key]) => key));
  const finished = store.topics.listActive().filter((topic) => {
    const memberKeys = store.memberships.listForTopic(topic.id).map((membership) => membership.prKey);
    return mayBeOver(memberKeys, states, unread) && topicRetireGate(store, at, topic.id).passes(topic.id);
  });
  store.transaction(() => {
    for (const topic of finished) {
      changeTopicStatus(store, topic.id, 'retire', at);
    }
  });
  return finished.length;
}
