import { EVENTS_PER_PR_IN_RECHECK, PRS_IN_RECHECK, type AgentService } from '@postpile/agent';
import {
  findDossierLine,
  type Fact,
  type MemoryRecheckRequest,
  type MemoryRecheckResult,
  type MemorySources,
  type Pr,
  type PrKey,
} from '@postpile/core';
import type { Store } from '@postpile/store';
import type { PromptContextSource } from '../prompt-context.ts';
import { loadViewer } from '../viewer-meta.ts';
import type { MemorySourcesReads } from './memory-sources-reads.ts';

/** Rechecks the user can ask for per rolling 24 hours. Each is one sonnet call. */
export const RECHECKS_PER_DAY = 40;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * "Recheck" on a fact or dossier line: one agent call that reads the line
 * against its sources, the topic dossier and the newest activity on the PRs
 * involved. Writes nothing; the user decides what to do with the outcome
 * (MemoryActions.correctMemory). The call lands in agent_call as an action.
 */
export class MemoryRechecker {
  constructor(
    private readonly store: Store,
    private readonly agent: AgentService,
    private readonly contexts: PromptContextSource,
    private readonly sources: MemorySourcesReads,
    private readonly now: () => Date,
  ) {}

  private overBudget(): boolean {
    const since = new Date(this.now().getTime() - DAY_MS).toISOString();
    return this.store.agentCalls.countSince('memory_recheck', since) >= RECHECKS_PER_DAY;
  }

  /** The PRs the line cites; without any, the topic's most recently updated ones. */
  private prsFor(request: MemoryRecheckRequest, fact: Fact | null, topicId: string | null): Pr[] {
    let keys: PrKey[] = fact ? fact.refs.map((ref) => ref.prKey) : [];
    const target = request.target;
    if (target?.kind === 'dossier_line') {
      const version = this.store.dossiers.get(target.topicId, target.version);
      const line = version ? findDossierLine(version.dossier, target.path) : null;
      keys = line?.sources.refs.map((ref) => ref.prKey) ?? [];
    }
    if (keys.length === 0 && topicId !== null) {
      keys = this.store.memberships.listForTopic(topicId).map((membership) => membership.prKey);
    }
    const prs = [...this.store.prs.getMany([...new Set(keys)]).values()];
    return prs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, PRS_IN_RECHECK);
  }

  private sourcesFor(request: MemoryRecheckRequest): MemorySources | null {
    if (request.target) {
      return this.sources.get(request.target);
    }
    return request.factId ? this.sources.get({ kind: 'fact', factId: request.factId }) : null;
  }

  async recheck(request: MemoryRecheckRequest): Promise<MemoryRecheckResult> {
    const fact = request.factId ? this.store.facts.get(request.factId) : null;
    if (request.factId && !fact) {
      return { status: 'unavailable', reason: 'not_found', message: 'That fact is gone.' };
    }
    const viewer = loadViewer(this.store);
    if (!viewer) {
      return { status: 'unavailable', reason: 'failed', message: 'No sync has run yet, so there is nothing to check against.' };
    }
    if (this.overBudget()) {
      return {
        status: 'unavailable',
        reason: 'budget',
        message: `Already ${RECHECKS_PER_DAY} rechecks in the last 24 hours, the daily cap. Tell the agent in the chat instead.`,
      };
    }
    const topicId = fact?.topicId ?? request.topicId;
    const topic = topicId ? this.store.topics.get(topicId) : null;
    const sources = this.sourcesFor(request);
    const prs = this.prsFor(request, fact, topic?.id ?? null);
    const events = prs.flatMap((pr) =>
      this.store.events
        .listForPr(pr.key)
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, EVENTS_PER_PR_IN_RECHECK),
    );
    try {
      const answer = await this.agent.recheckMemory({
        claim: request.text,
        recordedIn: sources?.recordedIn ?? (fact ? 'Fact' : 'Dossier'),
        topic,
        dossier: topic ? this.store.dossiers.latest(topic.id) : null,
        sources: sources?.sources ?? [],
        prs,
        events: events.sort((a, b) => b.at.localeCompare(a.at)),
        viewer,
        context: this.contexts.forTopic(topic?.id ?? null),
      });
      return { status: 'answered', ...answer };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return { status: 'unavailable', reason: 'failed', message: `The agent could not check it: ${detail}` };
    }
  }
}
