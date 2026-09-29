import { cleanTopicName, planTopicChange, type TopicChangeRequest, type TopicChangeResult, type TopicChangeSnapshot, type TopicProposal, type TopicSnapshot } from '@postpile/core';
import type { Store } from '@postpile/store';
import { Board } from '../board.ts';
import { newProposalId } from '../ids.ts';

const DAY_MS = 24 * 3600_000;

/**
 * propose_topic_change on the app side (DESIGN.md "propose_topic_change"):
 * checks an outside agent's topic change against the topics as they are
 * now and files it as a pending topic_proposal (source agent) for the user
 * to decide. Never applies it: topics change only on the user's Accept.
 */
export class OutsideProposals {
  constructor(
    private readonly store: Store,
    private readonly now: () => Date,
  ) {}

  private topicSnapshot(topicId: string | null): TopicSnapshot | null {
    const topic = topicId ? this.store.topics.get(topicId) : null;
    return topic ? { id: topic.id, name: topic.name, status: topic.status } : null;
  }

  private snapshot(change: TopicChangeRequest, at: string): TopicChangeSnapshot {
    const board = Board.load(this.store, at);
    const members = [...new Set(board.tilesForTopic(change.topicId).flatMap((tile) => tile.members.map((member) => member.prKey)))];
    return {
      now: at,
      topic: this.topicSnapshot(change.topicId),
      intoTopic: this.topicSnapshot(change.intoTopicId),
      members,
      topicIdOf: (key) => board.topicIdOf(key),
      // Every layer: the whole stack shows wherever the moved layers go.
      movesWith: (key) => board.stackKeysOf(key),
      proposals: this.store.proposals.listForTopic(change.topicId),
      pendingFromAgents: this.store.proposals.listPendingFromAgents(),
      filedLastDay: this.store.proposals.countFromAgentsSince(new Date(Date.parse(at) - DAY_MS).toISOString()),
    };
  }

  propose(change: TopicChangeRequest, client: string): TopicChangeResult {
    const at = this.now().toISOString();
    const plan = planTopicChange(change, this.snapshot(change, at));
    if (!plan.ok) {
      return { status: 'refused', proposalId: null, preview: [], reason: plan.reason, movedPrKeys: [] };
    }
    if (change.dryRun) {
      return { status: 'dry_run', proposalId: null, preview: plan.preview, reason: null, movedPrKeys: plan.movedPrKeys };
    }
    const proposal: TopicProposal = {
      id: newProposalId(),
      kind: change.kind,
      topicId: change.topicId,
      name: change.kind === 'merge' || change.name === null ? null : cleanTopicName(change.name),
      intoTopicId: change.kind === 'merge' ? change.intoTopicId : null,
      fromArea: null,
      prKeys: change.kind === 'split' ? change.prKeys : [],
      reason: change.reason.trim(),
      status: 'pending',
      createdAt: at,
      decidedAt: null,
      source: 'agent',
      client,
    };
    this.store.proposals.add(proposal);
    return { status: 'filed', proposalId: proposal.id, preview: plan.preview, reason: null, movedPrKeys: plan.movedPrKeys };
  }
}
