import { newTopic, type ActionResult, type TopicProposal } from '@code-manager/core';
import type { Store } from '@code-manager/store';
import { newTopicId } from '../ids.ts';
import { failed, ok } from './results.ts';

/** Topic renames, merges, splits and new topics only happen here, after the user said yes. */
export class ProposalActions {
  constructor(
    private readonly store: Store,
    private readonly now: () => Date,
  ) {}

  /** new_topic and split both end up here: a new topic with the proposal's PRs moved into it. */
  private createTopic(proposal: TopicProposal, at: string): void {
    const name = proposal.name ?? 'New topic';
    const topic = newTopic(newTopicId(name), name, at);
    this.store.topics.create(topic);
    for (const prKey of proposal.prKeys) {
      this.store.memberships.assign({ prKey, topicId: topic.id, assignedBy: 'user', reason: proposal.reason, createdAt: at });
    }
  }

  private applyAccepted(proposal: TopicProposal, at: string): void {
    if (proposal.kind === 'new_topic' || proposal.kind === 'split') {
      this.createTopic(proposal, at);
    } else if (proposal.kind === 'rename' && proposal.topicId && proposal.name) {
      this.store.topics.rename(proposal.topicId, proposal.name, at);
    } else if (proposal.kind === 'merge' && proposal.topicId && proposal.intoTopicId) {
      // A new created_at marks them as joined, so the target's next dossier update introduces them.
      for (const membership of this.store.memberships.listForTopic(proposal.topicId)) {
        this.store.memberships.assign({ ...membership, topicId: proposal.intoTopicId, createdAt: at });
      }
      this.store.topics.setStatus(proposal.topicId, 'archived', at);
    }
  }

  decide(proposalId: string, accept: boolean): ActionResult {
    const proposal = this.store.proposals.get(proposalId);
    if (!proposal) {
      return failed(`no proposal ${proposalId}`);
    }
    if (proposal.status !== 'pending') {
      return failed(`already ${proposal.status}`);
    }
    const at = this.now().toISOString();
    this.store.transaction(() => {
      if (accept) {
        this.applyAccepted(proposal, at);
      }
      this.store.proposals.decide(proposalId, accept ? 'accepted' : 'rejected', at);
    });
    return ok(accept ? 'Accepted' : 'Rejected');
  }
}
