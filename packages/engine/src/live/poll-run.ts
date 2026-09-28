import type { AgentCallStats, Viewer } from '@code-manager/core';
import { AgentBudget } from '../budget.ts';
import { reviveRetiredTopics } from '../consolidation/revive.ts';
import { TopicAssigner } from '../digest/topic-assignment.ts';
import { errorText } from '../errors.ts';
import type { GitHubSync } from '../github-sync.ts';
import { emptyFactCounts } from '../memory/fact-writer.ts';
import type { RunDeps } from '../run-deps.ts';
import type { PingDecider } from './ping-decider.ts';
import type { PollCycle } from './poll-cycle.ts';

/** PRs one poll fetches at most: two GraphQL batches. The rest wait for the next change or the full sync. */
export const POLL_MAX_PRS = 24;

/** Topic assignment calls one poll may make for PRs that are new to the app. */
export const POLL_TOPIC_CALLS = 1;

/**
 * One cycle of the fast poll: conditional inbox read; on a change, fetch the
 * PRs whose threads moved, log their events with rule loudness, give new PRs
 * a topic, and decide pings. Dossiers, glances, sets, stack layers and the
 * event second opinion are left to the regular full sync. Never marks
 * anything read on GitHub.
 */
export class PollRun {
  constructor(
    private readonly deps: RunDeps,
    private readonly github: GitHubSync,
    private readonly decider: PingDecider,
  ) {}

  private async assignTopics(viewer: Viewer, stats: AgentCallStats, errors: string[]): Promise<void> {
    const { store, agent, contexts, facts, now } = this.deps;
    const assigner = new TopicAssigner({
      store,
      agent,
      contexts,
      budget: new AgentBudget(POLL_TOPIC_CALLS, stats),
      facts,
      viewer,
      errors,
      tally: { dossiersUpdated: 0, facts: emptyFactCounts() },
      now,
    });
    await assigner.run();
  }

  async run(): Promise<PollCycle> {
    const { store, now, callLog } = this.deps;
    const inbox = await this.github.poll(POLL_MAX_PRS);
    const done = { kind: 'done' as const, notModified: inbox.notModified, githubPollIntervalSeconds: inbox.pollIntervalSeconds };
    if (inbox.notModified || !inbox.viewer || inbox.fetchedPrKeys.length === 0) {
      return { ...done, prsUpdated: 0, decisions: [], pings: [], errors: [] };
    }
    const errors: string[] = [];
    const startedAt = now().toISOString();
    const stats = callLog.begin(`poll:${startedAt}`);
    try {
      reviveRetiredTopics(store, inbox.newEventIds, startedAt);
      try {
        await this.assignTopics(inbox.viewer, stats, errors);
      } catch (error) {
        errors.push(`topics: ${errorText(error)}`);
      }
      // The first look at an empty store is the whole inbox; none of it is news.
      if (inbox.firstLook) {
        return { ...done, prsUpdated: inbox.fetchedPrKeys.length, decisions: [], pings: [], errors };
      }
      const decided = await this.decider.decide(inbox.fetchedPrKeys, inbox.newEventIds, inbox.viewer);
      return {
        ...done,
        prsUpdated: inbox.fetchedPrKeys.length,
        decisions: decided.decisions,
        pings: decided.pings,
        errors: [...errors, ...decided.errors],
      };
    } finally {
      callLog.end();
    }
  }
}
