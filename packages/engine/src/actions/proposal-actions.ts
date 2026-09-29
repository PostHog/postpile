import { cleanTopicName, EMPTY_TOPIC_NAME, hasEmptyTopicName, newTopic, proposalOutcome, type ActionResult, type PrKey, type TopicProposal } from '@postpile/core';
import type { Store } from '@postpile/store';
import { Board } from '../board.ts';
import { newTopicId } from '../ids.ts';
import { changeTopicStatus } from '../topic-status.ts';
import { failed, ok } from './results.ts';

/** Topic renames, merges, splits and new topics only happen here, after the user said yes. */
export class ProposalActions {
  constructor(
    private readonly store: Store,
    private readonly now: () => Date,
  ) {}

  /**
   * new_topic and split both end up here: a new topic with the proposal's
   * PRs moved into it. A stack layer brings its whole stack, so a split
   * never tears a stack apart.
   */
  private createTopic(proposal: TopicProposal, at: string): void {
    // whyStale refused an empty name already.
    const name = cleanTopicName(proposal.name ?? '');
    const topic = newTopic(newTopicId(name), name, at);
    this.store.topics.create(topic);
    const board = Board.load(this.store, at);
    const prKeys = new Set(proposal.prKeys.flatMap((key) => board.movesWith(key)));
    for (const prKey of prKeys) {
      this.store.memberships.assign({ prKey, topicId: topic.id, assignedBy: 'user', reason: proposal.reason, createdAt: at });
    }
  }

  private applyAccepted(proposal: TopicProposal, at: string): void {
    if (proposal.kind === 'new_topic' || proposal.kind === 'split') {
      this.createTopic(proposal, at);
    } else if (proposal.kind === 'rename' && proposal.topicId && proposal.name) {
      this.store.topics.rename(proposal.topicId, cleanTopicName(proposal.name), at);
    } else if (proposal.kind === 'merge' && proposal.topicId && proposal.intoTopicId) {
      // A new created_at marks them as joined, so the target's next dossier update introduces them.
      for (const membership of this.store.memberships.listForTopic(proposal.topicId)) {
        this.store.memberships.assign({ ...membership, topicId: proposal.intoTopicId, createdAt: at });
      }
      changeTopicStatus(this.store, proposal.topicId, 'archive', at);
    } else if (proposal.kind === 'area_merge' && proposal.fromArea && proposal.name) {
      this.store.topics.renameArea(proposal.fromArea, proposal.name, at);
    }
  }

  private isActive(topicId: string | null): boolean {
    return topicId !== null && this.store.topics.get(topicId)?.status === 'active';
  }

  /**
   * Why accepting no longer fits, or null. Topics move on after a proposal
   * is filed: its topic may be merged or retired, a split's PRs may have
   * moved elsewhere. An outside agent's split must also leave a PR behind;
   * consolidation may propose emptying a topic on purpose.
   */
  whyStale(proposal: TopicProposal, at: string): string | null {
    if (hasEmptyTopicName(proposal)) {
      return EMPTY_TOPIC_NAME.toLowerCase();
    }
    if (proposal.kind === 'new_topic' || proposal.kind === 'area_merge') {
      return null;
    }
    if (!this.isActive(proposal.topicId)) {
      return 'its topic is no longer active';
    }
    if (proposal.kind === 'merge' && (!this.isActive(proposal.intoTopicId) || proposal.intoTopicId === proposal.topicId)) {
      return 'the topic to merge into is no longer active';
    }
    if (proposal.kind !== 'split') {
      return null;
    }
    const board = Board.load(this.store, at);
    const gone = proposal.prKeys.filter((key) => board.topicIdOf(key) !== proposal.topicId);
    if (gone.length > 0) {
      return `${gone.join(', ')} left the topic since`;
    }
    // Every layer: the whole stack shows wherever the moved layers go.
    const moved = new Set<PrKey>(proposal.prKeys.flatMap((key) => board.stackKeysOf(key)));
    const members = board.tilesForTopic(proposal.topicId ?? '').flatMap((tile) => tile.members.map((member) => member.prKey));
    if (proposal.source === 'agent' && members.every((key) => moved.has(key))) {
      return 'no PR would stay behind';
    }
    return null;
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
    if (proposalOutcome(proposal, at) === 'expired') {
      return failed('This suggestion expired; nothing changed.');
    }
    const stale = accept ? this.whyStale(proposal, at) : null;
    if (stale) {
      return failed(`Can't accept: ${stale}. Nothing changed; reject it instead.`);
    }
    this.store.transaction(() => {
      if (accept) {
        this.applyAccepted(proposal, at);
      }
      this.store.proposals.decide(proposalId, accept ? 'accepted' : 'rejected', at);
    });
    return ok(accept ? 'Accepted' : 'Rejected');
  }
}
