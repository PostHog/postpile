import { splitAgentOffErrors, type AgentCallStats, type PrKey, type Viewer } from '@postpile/core';
import { Board } from '../board.ts';
import { AgentBudget } from '../budget.ts';
import { topicsToCatchUp } from '../catch-up/topic-catch-up.ts';
import { reviveRetiredTopics, reviveUnreadTopics } from '../consolidation/revive.ts';
import { TopicAssigner } from '../digest/topic-assignment.ts';
import { errorText } from '../errors.ts';
import { NO_FOCUS, type GitHubSync, type PollFocus } from '../github-sync.ts';
import { emptyFactCounts } from '../memory/fact-writer.ts';
import { advanceSeenFromGitHub } from '../memory/seen-from-github.ts';
import type { RunDeps } from '../run-deps.ts';
import type { PingDecider } from './ping-decider.ts';
import type { PollCycle } from './poll-cycle.ts';

/** PRs one poll fetches at most: two GraphQL batches. The rest wait for the next change or the full sync. */
export const POLL_MAX_PRS = 24;

/** Topic assignment calls one poll may make for PRs that are new to the app. */
export const POLL_TOPIC_CALLS = 1;

/**
 * One cycle of the fast poll: conditional inbox and read-threads reads, a
 * freshness check once a minute; on a change, fetch the PRs that moved, log their events with rule loudness, give new PRs
 * a topic, and decide pings. The topics whose PRs brought loud news or have
 * no glance yet go to onCatchUp, which runs their dossier and glances right
 * away (TopicCatchUp) instead of waiting for the next full sync. Sets and
 * stack layers stay with the full sync. Never marks anything read on GitHub.
 */
export class PollRun {
  constructor(
    private readonly deps: RunDeps,
    private readonly github: GitHubSync,
    private readonly decider: PingDecider,
    private readonly onCatchUp: (topicIds: (string | null)[]) => void = () => {},
    /** GitHub writes are on: a thread the next full sync clears by rule brings no finished topic back. */
    private readonly writesOn: () => boolean = () => false,
  ) {}

  /** After topic assignment, so a PR new to the app catches up in its new topic. */
  private requestCatchUps(fetchedPrKeys: PrKey[], newEventIds: string[]): void {
    const { store, now } = this.deps;
    const board = Board.load(store, now().toISOString());
    const glances = store.glances.getMany(fetchedPrKeys);
    const topics = topicsToCatchUp(board, fetchedPrKeys, newEventIds, (key) => glances.has(key));
    if (topics.length > 0) {
      this.onCatchUp(topics);
    }
  }

  /** Only the PRs this cycle fetched: the backlog without a topic is the full sync's job. */
  private async assignTopics(fetchedPrKeys: PrKey[], viewer: Viewer, stats: AgentCallStats, errors: string[]): Promise<void> {
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
    await assigner.run(fetchedPrKeys);
  }

  /**
   * One cycle, plus the Look closer pings glances wrote and the pings for
   * events the agent raised since the last one (they wait for the poll to reach the Mac).
   */
  async run(focus: PollFocus = NO_FOCUS): Promise<PollCycle> {
    const cycle = await this.runCycle(focus);
    const waiting = [...(this.deps.glancePings?.drain() ?? []), ...(this.deps.raisedPings?.drain() ?? [])];
    return cycle.kind === 'done' && waiting.length > 0 ? { ...cycle, pings: [...cycle.pings, ...waiting] } : cycle;
  }

  private async runCycle(focus: PollFocus): Promise<PollCycle> {
    const { store, now, callLog } = this.deps;
    const inbox = await this.github.poll(POLL_MAX_PRS, focus);
    const done = { kind: 'done' as const, notModified: inbox.notModified, githubPollIntervalSeconds: inbox.pollIntervalSeconds };
    // A thread read on github.com usually brings no PR to fetch, only read times.
    advanceSeenFromGitHub(store, inbox.readOnGitHub, now().toISOString());
    // A finished topic whose thread turned unread comes back, fetched PR or not, unless the next full sync clears it by rule.
    if (!inbox.notModified) {
      reviveUnreadTopics(store, now().toISOString(), this.writesOn());
    }
    if (inbox.notModified || !inbox.viewer || inbox.fetchedPrKeys.length === 0) {
      return { ...done, prsUpdated: 0, decisions: [], pings: [], errors: [] };
    }
    const errors: string[] = [];
    const startedAt = now().toISOString();
    const stats = callLog.begin(`poll:${startedAt}`);
    try {
      reviveRetiredTopics(store, inbox.newEventIds, startedAt);
      // Without the agent new PRs wait in Unsorted for a sync with it; the rules still ping.
      if (this.deps.agentOff() === null) {
        try {
          await this.assignTopics(inbox.fetchedPrKeys, inbox.viewer, stats, errors);
        } catch (error) {
          errors.push(`topics: ${errorText(error)}`);
        }
      }
      // The first look at an empty store is the whole inbox; none of it is news, and the full sync digests it.
      if (inbox.firstLook) {
        return { ...done, prsUpdated: inbox.fetchedPrKeys.length, decisions: [], pings: [], errors };
      }
      const decided = await this.decider.decide(inbox.fetchedPrKeys, inbox.newEventIds, inbox.viewer);
      // After the pings: they are the time-critical part and go first in the agent queue.
      if (this.deps.agentOff() === null) {
        this.requestCatchUps(inbox.fetchedPrKeys, inbox.newEventIds);
      }
      return {
        ...done,
        prsUpdated: inbox.fetchedPrKeys.length,
        decisions: decided.decisions,
        pings: decided.pings,
        // The decider falls back to rules while the agent is off; that is not worth a log line every cycle.
        errors: splitAgentOffErrors([...errors, ...decided.errors]).errors,
      };
    } finally {
      callLog.end();
    }
  }
}
