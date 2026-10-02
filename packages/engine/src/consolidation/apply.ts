import type { AreaMerge, ConsolidationResult, ConsolidationTopicProposal, RuleIdea } from '@postpile/agent';
import { cleanTopicName, hasEmptyTopicName, repeatsRejectedChange, ruleTextKey, type TopicProposal } from '@postpile/core';
import type { Store } from '@postpile/store';
import { ProposalActions } from '../actions/proposal-actions.ts';
import { Board } from '../board.ts';
import { newProposalId, newRuleProposalId } from '../ids.ts';
import type { FactWriter } from '../memory/fact-writer.ts';
import { changeTopicStatus } from '../topic-status.ts';
import type { RetireGate } from './retire-gate.ts';

export interface ConsolidationCounts {
  topicProposalsFiled: number;
  ruleProposalsFiled: number;
  factsMerged: number;
  topicsRetired: number;
  /** Small splits applied right away (`AUTO_SPLIT_MAX_PRS`). */
  topicsSplit: number;
}

/**
 * A split that moves at most this many PRs (stack layers included) is
 * applied right away instead of waiting in the Inbox (decided 2026-09-29).
 * A wrong one is fixed with "Wrong topic" on the PR, and that correction
 * reaches the next consolidation prompt.
 */
export const AUTO_SPLIT_MAX_PRS = 3;

/** How many decided rules are checked for "already proposed". */
const DECIDED_RULES_CHECKED = 500;

function normalized(text: string): string {
  return text.trim().toLowerCase();
}

/** Filed before and still standing: pending, accepted or rejected. A withdrawn one may come back. */
function sameIdea(filed: TopicProposal, idea: ConsolidationTopicProposal): boolean {
  if (filed.kind !== idea.kind || filed.status === 'withdrawn') {
    return false;
  }
  // A merge is about a pair of topics: B into A repeats A into B, so the Inbox never holds both directions.
  if (idea.kind === 'merge') {
    return (
      (filed.topicId === idea.topicId && filed.intoTopicId === idea.intoTopicId) ||
      (filed.topicId === idea.intoTopicId && filed.intoTopicId === idea.topicId)
    );
  }
  if (filed.topicId !== idea.topicId) {
    return false;
  }
  return normalized(filed.name ?? '') === normalized(cleanTopicName(idea.name));
}

function toTopicProposal(idea: ConsolidationTopicProposal, at: string): TopicProposal {
  return {
    id: newProposalId(),
    kind: idea.kind,
    topicId: idea.topicId,
    name: idea.kind === 'merge' ? null : cleanTopicName(idea.name),
    intoTopicId: idea.kind === 'merge' ? idea.intoTopicId : null,
    fromArea: null,
    prKeys: idea.kind === 'split' ? idea.prKeys : [],
    reason: idea.reason,
    status: 'pending',
    createdAt: at,
    decidedAt: null,
    source: 'consolidation',
    client: null,
  };
}

/**
 * Applies one consolidation answer. Topic changes and rules are only filed
 * as proposals (never the same idea twice, so a rejected one stays
 * rejected); duplicate facts are folded directly since that is internal
 * memory; a topic is retired only when the deterministic gate agrees.
 */
export class ConsolidationApplier {
  constructor(
    private readonly store: Store,
    private readonly facts: FactWriter,
    private readonly gate: RetireGate,
    private readonly counts: ConsolidationCounts,
    private readonly now: () => Date,
  ) {}

  /**
   * Small enough to apply without asking: every named PR is in the topic
   * now, the move (with its stack layers) is at most AUTO_SPLIT_MAX_PRS
   * PRs, and at least one PR stays behind.
   */
  private isSmallSplit(idea: ConsolidationTopicProposal, at: string): boolean {
    if (idea.kind !== 'split') {
      return false;
    }
    const members = new Set(this.store.memberships.listForTopic(idea.topicId).map((m) => m.prKey));
    if (!idea.prKeys.every((key) => members.has(key))) {
      return false;
    }
    const board = Board.load(this.store, at);
    const moved = new Set(idea.prKeys.flatMap((key) => board.movesWith(key)));
    return moved.size <= AUTO_SPLIT_MAX_PRS && members.size > moved.size;
  }

  private fileTopicProposal(idea: ConsolidationTopicProposal, at: string): void {
    if (this.store.topics.get(idea.topicId)?.status !== 'active') {
      return;
    }
    // The target may have been archived or merged away while the call ran; such a merge could never be accepted.
    if (idea.kind === 'merge' && this.store.topics.get(idea.intoTopicId)?.status !== 'active') {
      return;
    }
    // A merge's target holds the merges the other way round, so a "no" to either direction counts.
    const filed = [...this.store.proposals.listForTopic(idea.topicId), ...(idea.kind === 'merge' ? this.store.proposals.listForTopic(idea.intoTopicId) : [])];
    if (filed.some((earlier) => sameIdea(earlier, idea))) {
      return;
    }
    const proposal = toTopicProposal(idea, at);
    // Nothing left of the name after cleaning: a blank topic or a rename to nothing is no proposal.
    if (hasEmptyTopicName(proposal) || repeatsRejectedChange(proposal, filed)) {
      return;
    }
    this.store.proposals.add(proposal);
    if (this.isSmallSplit(idea, at)) {
      new ProposalActions(this.store, this.now).decide(proposal.id, true);
      this.counts.topicsSplit += 1;
      return;
    }
    this.counts.topicProposalsFiled += 1;
  }

  /** Never the same fold twice, and never the reverse of a rejected one, so a rejected one stays rejected. */
  private fileAreaMerge(merge: AreaMerge, at: string): void {
    const filed = this.store.proposals.listAreaMerges();
    if (filed.some((p) => p.fromArea === merge.from && p.name === merge.into)) {
      return;
    }
    const proposal: TopicProposal = {
      id: newProposalId(),
      kind: 'area_merge',
      topicId: null,
      name: merge.into,
      intoTopicId: null,
      fromArea: merge.from,
      prKeys: [],
      reason: merge.reason,
      status: 'pending',
      createdAt: at,
      decidedAt: null,
      source: 'consolidation',
      client: null,
    };
    if (repeatsRejectedChange(proposal, filed)) {
      return;
    }
    this.store.proposals.add(proposal);
    this.counts.topicProposalsFiled += 1;
  }

  private mergeFacts(keepId: string, dropIds: string[], reason: string, at: string): void {
    const keep = this.store.facts.get(keepId);
    if (!keep || keep.expiredAt !== null) {
      return;
    }
    for (const drop of this.store.facts.getMany(dropIds.filter((id) => id !== keepId)).values()) {
      if (drop.expiredAt !== null) {
        continue;
      }
      this.store.facts.addRefs(keepId, drop.refs, at);
      this.facts.close(drop.id, reason, at, keepId);
      this.counts.factsMerged += 1;
    }
  }

  /** Never the same text twice (pending, accepted or rejected), never for a topic that left the sidebar. */
  private fileRule(idea: RuleIdea, known: Set<string>, at: string): void {
    const key = ruleTextKey(idea.text);
    if (known.has(key)) {
      return;
    }
    if (idea.topicId !== null && this.store.topics.get(idea.topicId)?.status !== 'active') {
      return;
    }
    known.add(key);
    this.store.ruleProposals.add({
      id: newRuleProposalId(),
      text: idea.text.trim(),
      topicId: idea.topicId,
      evidenceFeedbackIds: idea.evidenceFeedbackIds,
      reason: idea.reason,
      status: 'pending',
      createdAt: at,
      decidedAt: null,
    });
    this.counts.ruleProposalsFiled += 1;
  }

  retire(topicId: string, at: string): void {
    if (this.gate.passes(topicId) && changeTopicStatus(this.store, topicId, 'retire', at)) {
      this.counts.topicsRetired += 1;
    }
  }

  apply(result: ConsolidationResult): void {
    const at = this.now().toISOString();
    const knownRules = new Set(
      [...this.store.ruleProposals.listPending(), ...this.store.ruleProposals.listDecided(DECIDED_RULES_CHECKED)].map(
        (rule) => ruleTextKey(rule.text),
      ),
    );
    this.store.transaction(() => {
      for (const idea of result.topicProposals) {
        this.fileTopicProposal(idea, at);
      }
      for (const merge of result.areaMerges) {
        this.fileAreaMerge(merge, at);
      }
      for (const merge of result.factMerges) {
        this.mergeFacts(merge.keepId, merge.dropIds, merge.reason, at);
      }
      for (const idea of result.ruleIdeas) {
        this.fileRule(idea, knownRules, at);
      }
      for (const finished of result.finishedTopics) {
        this.retire(finished.topicId, at);
      }
    });
  }
}
