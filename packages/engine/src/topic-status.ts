import { nextTopicStatus, type TopicStatusCause } from '@postpile/core';
import type { Store } from '@postpile/store';
import { withdrawStaleProposals } from './consolidation/withdraw.ts';

/**
 * The one writer of a topic's status: retire, revive and archive all go
 * through `nextTopicStatus`, so retiring always records its own time and a
 * cause that does not fit the topic's status changes nothing. Returns true
 * when the status changed. Callers that write more run it inside their own
 * transaction. A topic that leaves the sidebar takes its pending proposals
 * with it: they are withdrawn, nothing is left to accept.
 */
export function changeTopicStatus(store: Store, topicId: string, cause: TopicStatusCause, at: string): boolean {
  const topic = store.topics.get(topicId);
  const change = topic === null ? null : nextTopicStatus(topic, cause, at);
  if (change === null) {
    return false;
  }
  store.topics.setStatus(topicId, change, at);
  if (change.status !== 'active') {
    withdrawStaleProposals(store, at);
  }
  return true;
}
