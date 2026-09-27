import {
  dossierContextHash,
  FACTS_IN_DOSSIER_PROMPT,
  STALE_FACTS_IN_DOSSIER_PROMPT,
  type DossierUpdateInput,
  type DossierUpdateResult,
} from '@code-manager/agent';
import {
  isEmptyDelta,
  joinedMembers,
  selectTopicDelta,
  verifyDossier,
  verifyFact,
  withoutStaleClaims,
  type EntityRef,
  type Fact,
  type FactCandidate,
  type PrKey,
  type Topic,
} from '@code-manager/core';
import { Board } from '../board.ts';
import { errorText } from '../errors.ts';
import { verifyWorldFor } from '../memory/fact-world.ts';
import { FEEDBACK_IN_PROMPTS } from '../prompt-context.ts';
import type { DigestDeps } from './deps.ts';

/** Fact candidates one dossier update produced, still to be reconciled. */
export interface TopicCandidates {
  topicId: string;
  candidates: FactCandidate[];
}

export interface DossierRunResult {
  candidates: TopicCandidates[];
  /** Topics whose update the budget skipped. Their glances wait too, or they would be paid for twice. */
  skippedByBudget: Set<string>;
}

function contextHashKey(topicId: string): string {
  return `dossier_context_hash:${topicId}`;
}

/**
 * REFINE per topic: previous dossier + only the events since the digest
 * cursor -> new dossier version, flags and fact candidates. A topic with an
 * empty delta costs nothing, unless the user's instructions, tailoring or
 * standing rules changed since its last version: its userCares come from
 * those. Topics with unread tiles go first so a capped budget is spent where
 * the user looks first.
 */
export class DossierUpdater {
  constructor(private readonly deps: DigestDeps) {}

  private topicsInOrder(): Topic[] {
    const board = Board.load(this.deps.store, this.deps.now().toISOString());
    const hasUnread = (topic: Topic): boolean =>
      board.tilesForTopic(topic.id).some((tile) => board.stateOf(tile).kind === 'unread');
    const topics = this.deps.store.topics.listActive();
    return [...topics.filter(hasUnread), ...topics.filter((topic) => !hasUnread(topic))];
  }

  /** Active facts on the initiative and its PRs that pass verification, newest first. Context only. */
  private knownFacts(topic: Topic, memberKeys: PrKey[]): Fact[] {
    const { store } = this.deps;
    const entities: EntityRef[] = [
      { kind: 'initiative', key: topic.id },
      ...memberKeys.map((key): EntityRef => ({ kind: 'pr', key })),
    ];
    const facts = store.facts.listActiveForEntities(entities).filter((fact) => fact.staleAt === null);
    const world = verifyWorldFor(store, facts, this.deps.now().toISOString());
    return facts
      .filter((fact) => verifyFact(fact, world).kind === 'ok')
      .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))
      .slice(0, FACTS_IN_DOSSIER_PROMPT);
  }

  private input(topic: Topic): DossierUpdateInput | null {
    const { store } = this.deps;
    const memberships = store.memberships.listForTopic(topic.id);
    const memberKeys = memberships.map((m) => m.prKey);
    if (memberKeys.length === 0) {
      return null;
    }
    const prs = store.prs.getMany(memberKeys);
    const previous = store.dossiers.latest(topic.id);
    const cursorSeq = store.cursors.get('digest', topic.id)?.seq ?? previous?.throughSeq ?? 0;
    const staleFacts = store.facts.listStaleToRecheck(topic.id, STALE_FACTS_IN_DOSSIER_PROMPT);
    const world = { prs, memberKeys: new Set(memberKeys), now: this.deps.now().toISOString() };
    const memberSince = new Map(memberships.map((m) => [m.prKey, m.createdAt]));
    const joinedKeys = cursorSeq > 0 ? joinedMembers(memberKeys, memberSince, previous) : [];
    const delta = selectTopicDelta({
      topicId: topic.id,
      cursorSeq,
      memberKeys,
      memberSince,
      logged: store.eventLog.listSince(memberKeys, cursorSeq),
      joinedHistory: store.eventLog.listSince(joinedKeys, 0),
      previous,
      staleFacts,
      staleClaims: previous ? verifyDossier(previous.dossier, world) : [],
      feedback: store.feedback.recentForTopic(topic.id, FEEDBACK_IN_PROMPTS),
    });
    const context = this.deps.contexts.forTopic(topic.id);
    // No stored hash yet (a database from before it existed) counts as unchanged, so an upgrade costs nothing.
    const storedContextHash = store.meta.get(contextHashKey(topic.id));
    const contextChanged = storedContextHash !== null && storedContextHash !== dossierContextHash(context);
    if (isEmptyDelta(delta) && !contextChanged) {
      return null;
    }
    return {
      topic,
      previous,
      delta,
      prs: [...prs.values()],
      knownFacts: this.knownFacts(topic, memberKeys),
      staleFacts,
      viewer: this.deps.viewer,
      context,
    };
  }

  /**
   * New version, summary mirror, digest cursor and fact closes land together
   * or not at all. Claims that already fail verification are dropped before
   * storing, or the next sync would offer them as stale claims again.
   */
  private save(input: DossierUpdateInput, result: DossierUpdateResult): void {
    const { store, tally } = this.deps;
    const at = this.deps.now().toISOString();
    const topicId = input.topic.id;
    const version = (input.previous?.version ?? 0) + 1;
    const world = {
      prs: new Map(input.prs.map((pr) => [pr.key, pr])),
      memberKeys: new Set(input.prs.map((pr) => pr.key)),
      now: at,
    };
    store.transaction(() => {
      store.dossiers.add({
        topicId,
        version,
        dossier: withoutStaleClaims(result.dossier, world),
        flags: result.flags,
        inputHash: result.inputHash,
        throughSeq: input.delta.toSeq,
        model: result.model,
        createdAt: at,
      });
      store.topics.updateSummary(topicId, result.dossier.summary, result.inputHash, at);
      store.cursors.advance({ kind: 'digest', scope: topicId, seq: input.delta.toSeq, dossierVersion: version, updatedAt: at });
      store.meta.set(contextHashKey(topicId), dossierContextHash(input.context));
      for (const close of result.closeFacts) {
        this.deps.facts.close(close.factId, close.reason, at);
        tally.facts.invalidated += 1;
      }
      this.deps.facts.confirm(result.confirmedFactIds, tally.facts);
      store.facts.markRechecked(input.staleFacts.map((fact) => fact.id), at);
    });
    tally.dossiersUpdated += 1;
  }

  private async update(topic: Topic, run: DossierRunResult): Promise<void> {
    const { agent, budget } = this.deps;
    // Everything up to the agent call is synchronous, so budget.take runs in topic order.
    const input = this.input(topic);
    if (!input) {
      return;
    }
    if (!budget.take('dossier_update')) {
      run.skippedByBudget.add(topic.id);
      return;
    }
    try {
      const result = await agent.updateDossier(input);
      this.save(input, result);
      if (result.facts.length > 0) {
        run.candidates.push({ topicId: topic.id, candidates: result.facts });
      }
    } catch (error) {
      this.deps.errors.push(`dossier ${topic.id}: ${errorText(error)}`);
    }
  }

  async run(): Promise<DossierRunResult> {
    const run: DossierRunResult = { candidates: [], skippedByBudget: new Set() };
    await Promise.all(this.topicsInOrder().map((topic) => this.update(topic, run)));
    return run;
  }
}
