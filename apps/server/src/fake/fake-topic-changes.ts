import {
  isLiveProposal,
  newTopic,
  OUTSIDE_PROPOSAL_DAYS,
  planTopicChange,
  proposalOutcome,
  proposalOutcomeAt,
  type ActionResult,
  type PrKey,
  type Tile,
  type TopicChangeRequest,
  type TopicChangeResult,
  type TopicProposal,
  type TopicSnapshot,
} from '@postpile/core';
import type { SampleData } from './sample-data.ts';

function ok(message: string): ActionResult {
  return { ok: true, message, undoToken: null };
}

function fail(message: string): ActionResult {
  return { ok: false, message, undoToken: null };
}

/**
 * Topic proposals on sample data, in memory: the Inbox's list, Accept and
 * Reject (renames, merges, splits and area folds), and the recent outcomes
 * the MCP topic tool shows. A stack is one tile here, so a split moves whole
 * tiles, like `Board.movesWith` moves whole stacks in the real engine.
 */
export class FakeTopicChanges {
  constructor(
    private readonly data: SampleData,
    private readonly now: () => Date,
  ) {}

  private timestamp(): string {
    return this.now().toISOString();
  }

  private tilesOf(topicId: string): Tile[] {
    return this.data.tiles.filter((tile) => tile.topicId === topicId);
  }

  private topicPrKeys(topicId: string): PrKey[] {
    return this.tilesOf(topicId).flatMap((tile) => tile.members.map((member) => member.prKey));
  }

  private isActive(topicId: string | null): boolean {
    return this.data.topics.some((topic) => topic.id === topicId && topic.status === 'active');
  }

  /** Waiting for the user, across topics; expired outside ones left out. */
  pending(): TopicProposal[] {
    const now = this.timestamp();
    return this.data.proposals.filter((proposal) => isLiveProposal(proposal, now));
  }

  pendingForTopic(topicId: string): TopicProposal[] {
    return this.pending().filter((proposal) => proposal.topicId === topicId);
  }

  /** Accepted, rejected or expired in the last OUTSIDE_PROPOSAL_DAYS days, newest first. */
  decidedForTopic(topicId: string): TopicProposal[] {
    const now = this.timestamp();
    const since = new Date(this.now().getTime() - OUTSIDE_PROPOSAL_DAYS * 24 * 3600_000).toISOString();
    return this.data.proposals
      .filter((proposal) => proposal.topicId === topicId && proposalOutcome(proposal, now) !== 'pending' && (proposalOutcomeAt(proposal, now) ?? '') >= since)
      .sort((a, b) => (proposalOutcomeAt(b, now) ?? '').localeCompare(proposalOutcomeAt(a, now) ?? ''));
  }

  private topicSnapshot(topicId: string | null): TopicSnapshot | null {
    const topic = this.data.topics.find((candidate) => candidate.id === topicId);
    return topic ? { id: topic.id, name: topic.name, status: topic.status } : null;
  }

  /** The tile a PR shows in, like `Board.topicIdOf`. */
  private tileOf(key: PrKey): Tile | undefined {
    return this.data.tiles.find((tile) => tile.members.some((member) => member.prKey === key));
  }

  /**
   * An outside agent's topic change, checked and previewed by the same
   * planTopicChange as the engine, and filed in memory unless it is a dry
   * run. A stack moves whole (its tile's stack); sample splits move whole
   * tiles, which is the same for the sample's single-PR and stack tiles.
   */
  propose(change: TopicChangeRequest, client: string): TopicChangeResult {
    const now = this.timestamp();
    const dayAgo = new Date(this.now().getTime() - 24 * 3600_000).toISOString();
    const fromAgents = this.data.proposals.filter((proposal) => proposal.source === 'agent');
    const plan = planTopicChange(change, {
      now,
      topic: this.topicSnapshot(change.topicId),
      intoTopic: this.topicSnapshot(change.intoTopicId),
      members: [...new Set(this.topicPrKeys(change.topicId))],
      topicIdOf: (key) => this.tileOf(key)?.topicId ?? null,
      movesWith: (key) => this.tileOf(key)?.stacks.find((stack) => stack.prKeys.includes(key))?.prKeys ?? [key],
      proposals: this.data.proposals.filter((proposal) => proposal.topicId === change.topicId),
      pendingFromAgents: fromAgents.filter((proposal) => proposal.status === 'pending'),
      filedLastDay: fromAgents.filter((proposal) => proposal.createdAt >= dayAgo).length,
    });
    if (!plan.ok) {
      return { status: 'refused', proposalId: null, preview: [], reason: plan.reason, movedPrKeys: [] };
    }
    if (change.dryRun) {
      return { status: 'dry_run', proposalId: null, preview: plan.preview, reason: null, movedPrKeys: plan.movedPrKeys };
    }
    const proposal: TopicProposal = {
      id: `proposal-agent-${this.data.proposals.length + 1}`,
      kind: change.kind,
      topicId: change.topicId,
      name: change.kind === 'merge' ? null : (change.name?.trim() ?? null),
      intoTopicId: change.kind === 'merge' ? change.intoTopicId : null,
      fromArea: null,
      prKeys: change.kind === 'split' ? change.prKeys : [],
      reason: change.reason.trim(),
      status: 'pending',
      createdAt: now,
      decidedAt: null,
      source: 'agent',
      client,
    };
    this.data.proposals.push(proposal);
    return { status: 'filed', proposalId: proposal.id, preview: plan.preview, reason: null, movedPrKeys: plan.movedPrKeys };
  }

  /** The tiles a split moves: every tile of the topic holding one of its PRs. */
  splitTiles(topicId: string, prKeys: PrKey[]): Tile[] {
    return this.tilesOf(topicId).filter((tile) => tile.members.some((member) => prKeys.includes(member.prKey)));
  }

  /** Why accepting no longer fits (topics changed since it was filed), or null. The engine's ProposalActions checks the same. */
  whyStale(proposal: TopicProposal): string | null {
    if (proposal.kind === 'area_merge') {
      return null;
    }
    if (!this.isActive(proposal.topicId)) {
      return 'its topic is no longer active';
    }
    if (proposal.kind === 'merge' && !this.isActive(proposal.intoTopicId)) {
      return 'the topic to merge into is no longer active';
    }
    if (proposal.kind === 'split' && proposal.topicId) {
      const members = new Set(this.topicPrKeys(proposal.topicId));
      if (!proposal.prKeys.every((key) => members.has(key))) {
        return 'some of its PRs left the topic since';
      }
      const moved = new Set(this.splitTiles(proposal.topicId, proposal.prKeys).flatMap((tile) => tile.members.map((member) => member.prKey)));
      // Consolidation may propose emptying a topic on purpose; an outside agent must leave a PR behind.
      if (proposal.source === 'agent' && moved.size >= members.size) {
        return 'no PR would stay behind';
      }
    }
    return null;
  }

  decide(proposalId: string, accept: boolean): ActionResult {
    const proposal = this.data.proposals.find((candidate) => candidate.id === proposalId);
    const now = this.timestamp();
    if (!proposal || proposal.status !== 'pending') {
      return fail(`no pending proposal ${proposalId}`);
    }
    if (proposalOutcome(proposal, now) === 'expired') {
      return fail('This suggestion expired; nothing changed.');
    }
    const stale = accept ? this.whyStale(proposal) : null;
    if (stale) {
      return fail(`Can't accept: ${stale}. Nothing changed; reject it instead.`);
    }
    proposal.status = accept ? 'accepted' : 'rejected';
    proposal.decidedAt = now;
    if (accept) {
      this.apply(proposal);
    }
    return ok(accept ? 'accepted' : 'rejected');
  }

  private apply(proposal: TopicProposal): void {
    const topic = this.data.topics.find((candidate) => candidate.id === proposal.topicId);
    if (proposal.kind === 'rename' && topic && proposal.name) {
      topic.name = proposal.name;
      topic.updatedAt = this.timestamp();
    }
    if (proposal.kind === 'merge' && topic && proposal.intoTopicId) {
      this.merge(topic.id, proposal.intoTopicId);
    }
    if (proposal.kind === 'split' && topic && proposal.name) {
      this.split(topic.id, proposal.name, proposal.prKeys);
    }
    if (proposal.kind === 'area_merge' && proposal.fromArea && proposal.name) {
      for (const moved of this.data.topics.filter((candidate) => candidate.area === proposal.fromArea)) {
        moved.area = proposal.name;
      }
    }
  }

  /** Moves tiles and members over and archives the source topic. */
  private merge(fromTopicId: string, intoTopicId: string): void {
    for (const tile of this.tilesOf(fromTopicId)) {
      tile.topicId = intoTopicId;
    }
    for (const [prKey, topicId] of this.data.membership) {
      if (topicId === fromTopicId) {
        this.data.membership.set(prKey, intoTopicId);
      }
    }
    const topic = this.data.topics.find((candidate) => candidate.id === fromTopicId);
    if (topic) {
      topic.status = 'archived';
      topic.updatedAt = this.timestamp();
    }
  }

  /** A new topic in the same area with the tiles holding these PRs. */
  private split(fromTopicId: string, name: string, prKeys: PrKey[]): void {
    const from = this.data.topics.find((candidate) => candidate.id === fromTopicId);
    const id = `topic-split-${this.data.topics.length + 1}`;
    this.data.topics.push({ ...newTopic(id, name, this.timestamp()), area: from?.area ?? null });
    for (const tile of this.splitTiles(fromTopicId, prKeys)) {
      tile.topicId = id;
      for (const member of tile.members) {
        if (this.data.membership.get(member.prKey) === fromTopicId) {
          this.data.membership.set(member.prKey, id);
        }
      }
    }
  }
}
