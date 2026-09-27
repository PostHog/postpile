import type { AgentService, ConsolidationInput, ConsolidationTopic } from '@code-manager/agent';
import type { ConsolidateOptions, ConsolidationReport, DossierVersion, Fact, Topic } from '@code-manager/core';
import type { Store } from '@code-manager/store';
import { Board } from '../board.ts';
import type { AgentBudget } from '../budget.ts';
import { errorText } from '../errors.ts';
import { chunk } from '../lists.ts';
import type { FactWriter } from '../memory/fact-writer.ts';
import type { PromptContextSource } from '../prompt-context.ts';
import { ConsolidationApplier, type ConsolidationCounts } from './apply.ts';
import { RetireGate } from './retire-gate.ts';

/** A run is due this long after the last one, if a dossier changed since. */
export const CONSOLIDATION_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** Topics per consolidation call. */
export const CONSOLIDATION_TOPICS_PER_CALL = 40;
export const FEEDBACK_IN_CONSOLIDATION = 60;
export const DOSSIER_VERSIONS_KEPT = 50;
const DECIDED_RULES_IN_PROMPT = 50;
/** Active facts scanned for duplicates. */
const FACTS_SCANNED = 2000;

export interface ConsolidationDeps {
  store: Store;
  agent: AgentService;
  contexts: PromptContextSource;
  budget: AgentBudget;
  facts: FactWriter;
  errors: string[];
  now: () => Date;
}

/** Active facts sharing subject and predicate, in groups of two or more. */
function duplicateGroups(facts: Fact[]): Fact[][] {
  const groups = new Map<string, Fact[]>();
  for (const fact of facts) {
    const key = `${fact.subject.kind}:${fact.subject.key} ${fact.predicate}`;
    const group = groups.get(key) ?? [];
    group.push(fact);
    groups.set(key, group);
  }
  return [...groups.values()].filter((group) => group.length > 1);
}

/**
 * The sleep-time job, off the sync path. One agent call per 40 active
 * topics proposes merges, splits and renames, folds duplicate facts, turns
 * repeated feedback into rule proposals and names finished topics. The
 * deterministic part runs even without the agent: retire topics whose
 * dossier says finished and that pass the gate, and prune old dossier
 * versions.
 */
export class Consolidator {
  constructor(private readonly deps: ConsolidationDeps) {}

  private isDue(dossiers: DossierVersion[]): boolean {
    const cursor = this.deps.store.cursors.get('consolidate', 'global');
    if (!cursor) {
      return dossiers.length > 0;
    }
    const dueAt = new Date(new Date(cursor.updatedAt).getTime() + CONSOLIDATION_INTERVAL_MS);
    return this.deps.now() >= dueAt && dossiers.some((dossier) => dossier.createdAt > cursor.updatedAt);
  }

  private consolidationTopic(topic: Topic, dossier: DossierVersion | null): ConsolidationTopic {
    const keys = this.deps.store.memberships.listForTopic(topic.id).map((m) => m.prKey);
    const prs = [...this.deps.store.prs.getMany(keys).values()];
    const lastActivityAt = prs.map((pr) => pr.updatedAt).sort().at(-1) ?? null;
    return {
      topic,
      dossier,
      openPrs: prs.filter((pr) => pr.state === 'OPEN').length,
      totalPrs: prs.length,
      lastActivityAt,
    };
  }

  /** Facts and feedback go with the first chunk only, so a merge or rule is never proposed twice in one run. */
  private inputs(topics: ConsolidationTopic[]): ConsolidationInput[] {
    const { store } = this.deps;
    const decidedTopicProposals = store.topics
      .list()
      .flatMap((topic) => store.proposals.listForTopic(topic.id))
      .filter((proposal) => proposal.status !== 'pending');
    const shared = {
      decidedRules: store.ruleProposals.listDecided(DECIDED_RULES_IN_PROMPT),
      decidedTopicProposals,
      context: this.deps.contexts.forTopic(null),
    };
    return chunk(topics, CONSOLIDATION_TOPICS_PER_CALL).map((part, index) => ({
      ...shared,
      topics: part,
      duplicateFacts: index === 0 ? duplicateGroups(store.facts.query({ limit: FACTS_SCANNED })) : [],
      feedback: index === 0 ? store.feedback.recent(FEEDBACK_IN_CONSOLIDATION) : [],
    }));
  }

  /** Returns false when a call failed or the budget stopped it, so the run stays due. */
  private async askAgent(inputs: ConsolidationInput[], applier: ConsolidationApplier): Promise<boolean> {
    let complete = true;
    for (const input of inputs) {
      if (!this.deps.budget.take('consolidation')) {
        return false;
      }
      try {
        applier.apply(await this.deps.agent.consolidate(input));
      } catch (error) {
        this.deps.errors.push(`consolidation: ${errorText(error)}`);
        complete = false;
      }
    }
    return complete;
  }

  private retireFinished(dossiers: Map<string, DossierVersion>, applier: ConsolidationApplier): void {
    const at = this.deps.now().toISOString();
    this.deps.store.transaction(() => {
      for (const [topicId, dossier] of dossiers) {
        if (dossier.dossier.status === 'finished') {
          applier.retire(topicId, at);
        }
      }
    });
  }

  private pruneDossiers(topicIds: string[]): void {
    for (const topicId of topicIds) {
      this.deps.store.dossiers.prune(topicId, DOSSIER_VERSIONS_KEPT);
    }
  }

  async run(options: ConsolidateOptions, report: ConsolidationReport): Promise<void> {
    const { store } = this.deps;
    const topics = store.topics.listActive();
    const dossiers = store.dossiers.latestMany(topics.map((t) => t.id));
    if (options.onlyIfDue && !this.isDue([...dossiers.values()])) {
      report.skipped = 'not_due';
      return;
    }
    const board = Board.load(store, this.deps.now().toISOString());
    const counts: ConsolidationCounts = report;
    const applier = new ConsolidationApplier(store, this.deps.facts, new RetireGate(board), counts, this.deps.now);

    const offered = topics.map((topic) => this.consolidationTopic(topic, dossiers.get(topic.id) ?? null));
    const complete = offered.length === 0 || (await this.askAgent(this.inputs(offered), applier));
    this.retireFinished(dossiers, applier);
    this.pruneDossiers(topics.map((t) => t.id));
    if (complete) {
      store.cursors.advance({
        kind: 'consolidate',
        scope: 'global',
        seq: store.eventLog.maxSeq(),
        dossierVersion: null,
        updatedAt: this.deps.now().toISOString(),
      });
    }
  }
}
