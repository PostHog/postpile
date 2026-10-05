import type { AgentService, AreaChoice, ConsolidationInput, ConsolidationTopic } from '@postpile/agent';
import {
  PREDICATE_RULES,
  type ConsolidateOptions,
  type ConsolidationReport,
  type DossierVersion,
  type EntityRef,
  type Fact,
  type LightPr,
  type PrKey,
  type Topic,
} from '@postpile/core';
import type { Store } from '@postpile/store';
import { Board } from '../board.ts';
import type { AgentBudget } from '../budget.ts';
import { errorText } from '../errors.ts';
import { chunk } from '../lists.ts';
import type { FactWriter } from '../memory/fact-writer.ts';
import type { PromptContextSource } from '../prompt-context.ts';
import { ConsolidationApplier, type ConsolidationCounts } from './apply.ts';
import { topicRetireGate } from './retire.ts';

/** A run is due this long after the last one, if a dossier changed since. */
export const CONSOLIDATION_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** Topics per consolidation call. */
export const CONSOLIDATION_TOPICS_PER_CALL = 40;
export const FEEDBACK_IN_CONSOLIDATION = 60;
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

function entityKey(entity: EntityRef | null): string {
  return entity ? `${entity.kind}:${entity.key}` : '-';
}

/**
 * Facts that could say the same thing share a slot: subject and predicate
 * for per_subject, predicate and object for per_object, subject, predicate
 * and object otherwise. "alice works_on #1" and "alice works_on #2" are two
 * true facts, not duplicates.
 */
function slotKey(fact: Fact): string {
  const unique = PREDICATE_RULES[fact.predicate].unique;
  if (unique === 'per_subject') {
    return `${fact.predicate} ${entityKey(fact.subject)}`;
  }
  if (unique === 'per_object' && fact.object !== null) {
    return `${fact.predicate} -> ${entityKey(fact.object)}`;
  }
  return `${fact.predicate} ${entityKey(fact.subject)} -> ${entityKey(fact.object)}`;
}

/** Active facts sharing a slot, in groups of two or more. */
function duplicateGroups(facts: Fact[]): Fact[][] {
  const groups = new Map<string, Fact[]>();
  for (const fact of facts) {
    const key = slotKey(fact);
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
 * dossier says finished and that pass the gate.
 */
/** Areas of these topics with how many topics use each, most used first. */
function areasInUse(topics: Topic[]): AreaChoice[] {
  const counts = new Map<string, number>();
  for (const topic of topics) {
    if (topic.area) {
      counts.set(topic.area, (counts.get(topic.area) ?? 0) + 1);
    }
  }
  return [...counts].map(([name, count]) => ({ name, topics: count })).sort((a, b) => b.topics - a.topics);
}

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

  /** Counts from the light rows (`light`, by key): reading every topic's snapshots cost a heavy install seconds and gigabytes. */
  private consolidationTopic(topic: Topic, dossier: DossierVersion | null, board: Board, light: Map<PrKey, LightPr>): ConsolidationTopic {
    const keys = this.deps.store.memberships.listForTopic(topic.id).map((m) => m.prKey);
    const prs = keys.flatMap((key) => light.get(key) ?? []);
    const lastActivityAt = prs.map((pr) => pr.updatedAt).sort().at(-1) ?? null;
    return {
      topic,
      dossier,
      openPrs: prs.filter((pr) => pr.state === 'OPEN').length,
      totalPrs: prs.length,
      lastActivityAt,
      liveTiles: board.tilesForTopic(topic.id).filter((tile) => board.stateOf(tile).kind !== 'done').length,
    };
  }

  /** Facts and feedback go with the first chunk only, so a merge or rule is never proposed twice in one run. */
  private inputs(topics: ConsolidationTopic[]): ConsolidationInput[] {
    const { store } = this.deps;
    // Only the user's own decisions: a withdrawn proposal is not a "no".
    const decidedTopicProposals = [...store.topics.list().flatMap((topic) => store.proposals.listForTopic(topic.id)), ...store.proposals.listAreaMerges()]
      .filter((proposal) => proposal.status === 'accepted' || proposal.status === 'rejected');
    const shared = {
      decidedRules: store.ruleProposals.listDecided(DECIDED_RULES_IN_PROMPT),
      decidedTopicProposals,
      areas: areasInUse(topics.map((entry) => entry.topic)),
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
    const applier = new ConsolidationApplier(store, this.deps.facts, (topicId) => topicRetireGate(store, this.deps.now().toISOString(), topicId), counts, this.deps.now);

    const light = new Map(store.prs.listLight().map((pr) => [pr.key, pr]));
    const offered = topics.map((topic) => this.consolidationTopic(topic, dossiers.get(topic.id) ?? null, board, light));
    const complete = offered.length === 0 || (await this.askAgent(this.inputs(offered), applier));
    this.retireFinished(dossiers, applier);
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
