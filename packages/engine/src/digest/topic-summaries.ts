import { topicSummaryInputHash, type TopicChangeProposal, type TopicSummaryInput } from '@code-manager/agent';
import type { Pr, Topic, TopicProposal } from '@code-manager/core';
import { errorText } from '../errors.ts';
import { newProposalId } from '../ids.ts';
import type { DigestDeps } from './deps.ts';

/** Bounds the summary prompt for big topics: the most recently updated PRs tell the story. */
export const SUMMARY_MAX_PRS = 40;

function sameIdea(filed: TopicProposal, idea: TopicChangeProposal): boolean {
  if (filed.kind !== idea.kind) {
    return false;
  }
  return idea.kind === 'rename'
    ? filed.name?.trim().toLowerCase() === idea.name.trim().toLowerCase()
    : filed.intoTopicId === idea.intoTopicId;
}

/**
 * Rewrites a topic summary only when its member PRs (or instructions) changed.
 * Rename and merge ideas from the same answer are filed as pending proposals;
 * the topic itself never changes here.
 */
export class TopicSummarizer {
  constructor(private readonly deps: DigestDeps) {}

  private memberPrs(topic: Topic): Pr[] {
    const { store } = this.deps;
    const keys = store.memberships.listForTopic(topic.id).map((m) => m.prKey);
    return [...store.prs.getMany(keys).values()]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, SUMMARY_MAX_PRS);
  }

  private input(topic: Topic, prs: Pr[]): TopicSummaryInput {
    const otherTopics = this.deps.store.topics
      .listActive()
      .filter((t) => t.id !== topic.id)
      .map((t) => ({ id: t.id, name: t.name, summary: t.summary }));
    return { topic, prs, otherTopics, context: this.deps.contexts.forTopic(topic.id) };
  }

  /** The same idea is never filed twice, so a rejected rename does not come back. */
  private fileProposals(topic: Topic, ideas: TopicChangeProposal[], at: string): void {
    const { store } = this.deps;
    const filed = store.proposals.listForTopic(topic.id);
    for (const idea of ideas) {
      if (filed.some((proposal) => sameIdea(proposal, idea))) {
        continue;
      }
      const proposal: TopicProposal = {
        id: newProposalId(),
        kind: idea.kind,
        topicId: topic.id,
        name: idea.kind === 'rename' ? idea.name : null,
        intoTopicId: idea.kind === 'merge' ? idea.intoTopicId : null,
        prKeys: [],
        reason: idea.reason,
        status: 'pending',
        createdAt: at,
        decidedAt: null,
      };
      store.proposals.add(proposal);
      filed.push(proposal);
    }
  }

  private async summarize(topic: Topic): Promise<void> {
    const prs = this.memberPrs(topic);
    if (prs.length === 0) {
      return;
    }
    const input = this.input(topic, prs);
    if (topicSummaryInputHash(input) === topic.summaryInputHash || !this.deps.budget.take()) {
      return;
    }
    try {
      const result = await this.deps.agent.summarizeTopic(input);
      const at = this.deps.now().toISOString();
      this.deps.store.transaction(() => {
        this.deps.store.topics.updateSummary(topic.id, result.summary, result.inputHash, at);
        this.fileProposals(topic, result.proposals, at);
      });
    } catch (error) {
      this.deps.errors.push(`summary ${topic.id}: ${errorText(error)}`);
    }
  }

  async run(): Promise<void> {
    await Promise.all(this.deps.store.topics.listActive().map((topic) => this.summarize(topic)));
  }
}
