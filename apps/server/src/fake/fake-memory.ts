import type {
  ActionResult,
  ConsolidationReport,
  DossierVersion,
  DossierView,
  Fact,
  FactQuery,
  FactView,
  Feedback,
  PrKey,
  RuleProposal,
  Topic,
} from '@code-manager/core';
import { dossierVersionNotes, emptyAgentCallStats, topicChangesSince } from '@code-manager/core';
import type { SampleData } from './sample-data.ts';
import { buildSampleMemory, type SampleMemory } from './sample-memory.ts';

const DEFAULT_FACT_LIMIT = 100;

function isActive(fact: Fact): boolean {
  return fact.invalidAt === null && fact.expiredAt === null;
}

function toView(fact: Fact): FactView {
  return { fact, stale: fact.staleReason };
}

function touchesEntity(fact: Fact, kind: string, key: string): boolean {
  const matches = (entity: { kind: string; key: string } | null) => entity !== null && entity.kind === kind && entity.key === key;
  return matches(fact.subject) || matches(fact.object);
}

function touchesPr(fact: Fact, prKey: PrKey): boolean {
  return touchesEntity(fact, 'pr', prKey) || fact.refs.some((ref) => ref.prKey === prKey);
}

/**
 * Engine memory for FakeEngine: dossiers, facts, rule proposals and seen
 * cursors, all in memory. Reads mirror MemoryReads in the engine, but stale
 * flags come from the sample instead of verify-before-use.
 */
export class FakeMemory {
  private readonly memory: SampleMemory;

  constructor(
    private readonly data: SampleData,
    private readonly now: () => Date,
  ) {
    this.memory = buildSampleMemory(now());
  }

  /** The "not mine" entries the sample's rule proposal cites. FakeEngine starts its feedback log with them. */
  seedFeedback(): Feedback[] {
    return this.memory.feedback;
  }

  private latest(topicId: string): DossierVersion | null {
    return this.memory.dossiers.get(topicId)?.at(-1) ?? null;
  }

  private eventsAfter(topicId: string, since: string): number {
    const members = new Set([...this.data.membership].filter(([, id]) => id === topicId).map(([prKey]) => prKey));
    return this.data.events.filter((event) => members.has(event.prKey) && event.at > since).length;
  }

  private correctedClaims(topicId: string, since: string, feedback: Feedback[]): string[] {
    return feedback
      .filter((entry) => entry.topicId === topicId && entry.createdAt > since)
      .filter((entry) => entry.kind === 'memory_wrong' || entry.kind === 'memory_forget')
      .map((entry) => entry.note);
  }

  dossierView(topicId: string, feedback: Feedback[]): DossierView | null {
    const latest = this.latest(topicId);
    if (!latest) {
      return null;
    }
    const seen = this.memory.seen.get(topicId) ?? null;
    const changedFacts = seen
      ? this.memory.facts.filter((fact) => fact.topicId === topicId && (fact.recordedAt > seen.updatedAt || (fact.expiredAt ?? '') > seen.updatedAt))
      : [];
    const versionsNewestFirst = [...(this.memory.dossiers.get(topicId) ?? [])].reverse();
    // Sample story: the thread behind the DEPOT_TOKEN question was resolved on GitHub.
    const staleClaims = topicId === 'topic-depot' ? [{ path: 'openQuestions[2]', reason: 'thread_resolved' as const }] : [];
    return {
      version: latest.version,
      createdAt: latest.createdAt,
      dossier: latest.dossier,
      flags: latest.flags,
      staleClaims,
      changesSinceSeen: topicChangesSince(seen, latest, changedFacts, seen ? this.eventsAfter(topicId, seen.updatedAt) : 0),
      eventsBehind: this.eventsAfter(topicId, latest.createdAt),
      history: dossierVersionNotes(versionsNewestFirst),
      correctedClaims: this.correctedClaims(topicId, latest.createdAt, feedback),
    };
  }

  prFacts(prKey: PrKey): FactView[] {
    return this.memory.facts.filter((fact) => isActive(fact) && touchesPr(fact, prKey)).map(toView);
  }

  listFacts(query: FactQuery): FactView[] {
    const includeClosed = query.includeClosed === true || query.changedSince !== undefined;
    const since = query.changedSince;
    const facts = this.memory.facts
      .filter((fact) => includeClosed || isActive(fact))
      .filter((fact) => !query.entity || touchesEntity(fact, query.entity.kind, query.entity.key))
      .filter((fact) => !query.predicate || fact.predicate === query.predicate)
      .filter((fact) => !query.topicId || fact.topicId === query.topicId)
      .filter((fact) => !since || fact.recordedAt > since || (fact.expiredAt ?? '') > since)
      .toSorted((a, b) => b.recordedAt.localeCompare(a.recordedAt));
    return facts.slice(0, query.limit ?? DEFAULT_FACT_LIMIT).map(toView);
  }

  pendingRuleProposals(): RuleProposal[] {
    return this.memory.ruleProposals.filter((proposal) => proposal.status === 'pending');
  }

  /** An accepted topic rule is appended to the topic's tailoring, like the real engine does. */
  decideRuleProposal(proposalId: string, accept: boolean, topics: Topic[]): ActionResult {
    const proposal = this.memory.ruleProposals.find((candidate) => candidate.id === proposalId);
    if (!proposal) {
      return { ok: false, message: `no rule proposal ${proposalId}`, undoToken: null };
    }
    if (proposal.status !== 'pending') {
      return { ok: false, message: `already ${proposal.status}`, undoToken: null };
    }
    const at = this.now().toISOString();
    proposal.status = accept ? 'accepted' : 'rejected';
    proposal.decidedAt = at;
    const topic = topics.find((candidate) => candidate.id === proposal.topicId);
    if (accept && topic) {
      topic.tailoring = topic.tailoring ? `${topic.tailoring}\n${proposal.text}` : proposal.text;
      topic.updatedAt = at;
    }
    return { ok: true, message: accept ? 'Accepted' : 'Rejected', undoToken: null };
  }

  markTopicSeen(topicId: string): void {
    const at = this.now().toISOString();
    const version = this.latest(topicId)?.version ?? null;
    this.memory.seen.set(topicId, { kind: 'seen', scope: topicId, seq: 0, dossierVersion: version, updatedAt: at });
  }

  /** Closes an active fact and returns it, or null when there is no such active fact. */
  closeFact(factId: string, reason: string): Fact | null {
    const fact = this.memory.facts.find((candidate) => candidate.id === factId);
    if (!fact || !isActive(fact)) {
      return null;
    }
    const at = this.now().toISOString();
    fact.invalidAt = at;
    fact.invalidReason = reason;
    fact.expiredAt = at;
    return fact;
  }

  /** Files the sample's next rule proposal once. A second run finds nothing new. */
  consolidate(): ConsolidationReport {
    const startedAt = this.now().toISOString();
    const filed = this.memory.nextRuleProposals.splice(0);
    this.memory.ruleProposals.push(...filed);
    const agentCallStats = emptyAgentCallStats();
    agentCallStats.total = 1;
    agentCallStats.byKind.consolidation = { calls: 1, failed: 0, retries: 0, skippedUnchanged: 0, skippedByBudget: 0, durationMs: 21000, costUsd: 0.04 };
    return {
      startedAt,
      finishedAt: this.now().toISOString(),
      skipped: null,
      topicProposalsFiled: 0,
      ruleProposalsFiled: filed.length,
      factsMerged: 0,
      topicsRetired: 0,
      agentCallStats,
      errors: [],
    };
  }
}
