import { preReconcile, type AmbiguousCandidate, type EntityRef, type FactCandidate, type ReconcileAction } from '@postpile/core';
import { errorText } from '../errors.ts';
import { chunk } from '../lists.ts';
import type { DigestDeps } from './deps.ts';
import type { TopicCandidates } from './dossiers.ts';

/** Ambiguous candidates per reconcile call, across topics. */
export const RECONCILE_BATCH_SIZE = 40;

interface PendingItem {
  item: AmbiguousCandidate;
  topicId: string;
}

/**
 * Subjects and objects of the candidates. Objects matter for per-object
 * predicates: "bob drives X" must see "alice drives X" to replace it.
 */
function entitiesOf(candidates: FactCandidate[]): EntityRef[] {
  const seen = new Map<string, EntityRef>();
  for (const candidate of candidates) {
    for (const entity of [candidate.subject, candidate.object]) {
      if (entity !== null) {
        seen.set(`${entity.kind}:${entity.key}`, entity);
      }
    }
  }
  return [...seen.values()];
}

/**
 * Extract-then-reconcile for the candidates the dossier updates produced.
 * preReconcile settles most of them without the agent; only the ambiguous
 * rest goes to reconcileFacts, 40 per call. Usually that is zero calls.
 */
export class FactReconciler {
  constructor(private readonly deps: DigestDeps) {}

  private apply(actions: ReconcileAction[], topicIdOf: (action: ReconcileAction) => string | null): void {
    const { store, facts, tally } = this.deps;
    store.transaction(() => {
      for (const action of actions) {
        facts.apply(action, topicIdOf(action), tally.facts);
      }
    });
  }

  private settleDeterministic(topic: TopicCandidates): PendingItem[] {
    const existing = this.deps.store.facts.listActiveForEntities(entitiesOf(topic.candidates));
    const result = preReconcile(topic.candidates, existing);
    this.apply(result.actions, () => topic.topicId);
    return result.ambiguous.map((item) => ({ item, topicId: topic.topicId }));
  }

  private async askAgent(batch: PendingItem[]): Promise<void> {
    // Actions carry the candidate object they were given, which is how a new fact finds its topic.
    const topicByCandidate = new Map(batch.map((pending) => [pending.item.candidate, pending.topicId]));
    try {
      const actions = await this.deps.agent.reconcileFacts({
        items: batch.map((pending) => pending.item),
        context: this.deps.contexts.forTopic(null),
      });
      this.apply(actions, (action) =>
        action.kind === 'add' || action.kind === 'update' ? (topicByCandidate.get(action.candidate) ?? null) : null,
      );
    } catch (error) {
      this.deps.errors.push(`facts: ${errorText(error)}`);
    }
  }

  async run(topics: TopicCandidates[]): Promise<void> {
    const pending = topics.flatMap((topic) => this.settleDeterministic(topic));
    for (const batch of chunk(pending, RECONCILE_BATCH_SIZE)) {
      if (!this.deps.budget.take('fact_reconcile')) {
        break;
      }
      await this.askAgent(batch);
    }
  }
}
