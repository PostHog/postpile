import { staleRuleProposalIds, staleTopicProposalIds } from '@postpile/core';
import type { Store } from '@postpile/store';

/**
 * Withdraws pending proposals that name a topic no longer active: topic
 * changes on either side, and rules scoped to it. No agent call, so it runs
 * on every full sync and whenever a topic retires or is archived. Withdrawn
 * is the app's call, not the user's: it never counts as a rejection.
 * Returns how many were withdrawn.
 */
export function withdrawStaleProposals(store: Store, at: string): number {
  const isActive = (topicId: string): boolean => store.topics.get(topicId)?.status === 'active';
  const topicIds = staleTopicProposalIds(store.proposals.listPending(), isActive);
  const ruleIds = staleRuleProposalIds(store.ruleProposals.listPending(), isActive);
  store.transaction(() => {
    for (const id of topicIds) {
      store.proposals.decide(id, 'withdrawn', at);
    }
    for (const id of ruleIds) {
      store.ruleProposals.decide(id, 'withdrawn', at);
    }
  });
  return topicIds.length + ruleIds.length;
}
