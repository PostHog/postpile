import { topicSummaryInputHash } from '@code-manager/agent';
import type { Pr, Topic } from '@code-manager/core';
import { errorText, type DigestDeps } from './deps.ts';

/** Bounds the summary prompt for big topics: the most recently updated PRs tell the story. */
export const SUMMARY_MAX_PRS = 40;

/** Rewrites a topic summary only when its member PRs (or instructions) changed. */
export class TopicSummarizer {
  constructor(private readonly deps: DigestDeps) {}

  private memberPrs(topic: Topic): Pr[] {
    const { store } = this.deps;
    const keys = store.memberships.listForTopic(topic.id).map((m) => m.prKey);
    return [...store.prs.getMany(keys).values()]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, SUMMARY_MAX_PRS);
  }

  private async summarize(topic: Topic): Promise<void> {
    const prs = this.memberPrs(topic);
    if (prs.length === 0) {
      return;
    }
    const input = { topic, prs, context: this.deps.contexts.forTopic(topic.id) };
    if (topicSummaryInputHash(input) === topic.summaryInputHash || !this.deps.budget.take()) {
      return;
    }
    try {
      const result = await this.deps.agent.summarizeTopic(input);
      this.deps.store.topics.updateSummary(topic.id, result.summary, result.inputHash, this.deps.now().toISOString());
    } catch (error) {
      this.deps.errors.push(`summary ${topic.id}: ${errorText(error)}`);
    }
  }

  async run(): Promise<void> {
    await Promise.all(this.deps.store.topics.listActive().map((topic) => this.summarize(topic)));
  }
}
