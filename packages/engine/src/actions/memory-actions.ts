import type { ActionResult, PendingProposals } from '@code-manager/core';
import type { Store } from '@code-manager/store';
import { UNSORTED_TOPIC_ID } from '../board.ts';
import { failed, ok } from './results.ts';

/** User decisions on engine memory: standing rules and "I have seen this topic". */
export class MemoryActions {
  constructor(
    private readonly store: Store,
    private readonly now: () => Date,
  ) {}

  listProposals(): PendingProposals {
    return { topics: this.store.proposals.listPending(), rules: this.store.ruleProposals.listPending() };
  }

  /** An accepted global rule goes into every prompt from the rule table; a topic rule is appended to the tailoring. */
  decideRuleProposal(proposalId: string, accept: boolean): ActionResult {
    const proposal = this.store.ruleProposals.get(proposalId);
    if (!proposal) {
      return failed(`no rule proposal ${proposalId}`);
    }
    if (proposal.status !== 'pending') {
      return failed(`already ${proposal.status}`);
    }
    const at = this.now().toISOString();
    const topic = proposal.topicId === null ? null : this.store.topics.get(proposal.topicId);
    this.store.transaction(() => {
      if (accept && topic) {
        const tailoring = topic.tailoring.trim() ? `${topic.tailoring.trim()}\n${proposal.text}` : proposal.text;
        this.store.topics.setTailoring(topic.id, tailoring, at);
      }
      this.store.ruleProposals.decide(proposalId, accept ? 'accepted' : 'rejected', at);
    });
    return ok(accept ? 'Accepted' : 'Rejected');
  }

  /** Moves the seen cursor to the newest logged event and the current dossier version. */
  markTopicSeen(topicId: string): ActionResult {
    if (topicId === UNSORTED_TOPIC_ID || !this.store.topics.get(topicId)) {
      return failed(`no topic ${topicId}`);
    }
    this.store.cursors.advance({
      kind: 'seen',
      scope: topicId,
      seq: this.store.eventLog.maxSeq(),
      dossierVersion: this.store.dossiers.latest(topicId)?.version ?? null,
      updatedAt: this.now().toISOString(),
    });
    return ok('Marked seen');
  }
}
