import { FACTS_IN_DOSSIER_PROMPT, type DossierUpdateInput, type DossierUpdateResult } from '@code-manager/agent';
import {
  isEmptyDelta,
  selectTopicDelta,
  verifyDossier,
  verifyFact,
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

/**
 * REFINE per topic: previous dossier + only the events since the digest
 * cursor -> new dossier version, flags and fact candidates. A topic with an
 * empty delta costs nothing; an input hash equal to the latest version's
 * (a retry after a crash) is skipped too. Topics with unread tiles go first
 * so a capped budget is spent where the user looks first.
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
    const staleFacts = store.facts.listStaleForTopic(topic.id);
    const world = { prs, memberKeys: new Set(memberKeys), now: this.deps.now().toISOString() };
    const delta = selectTopicDelta({
      topicId: topic.id,
      cursorSeq,
      memberKeys,
      memberSince: new Map(memberships.map((m) => [m.prKey, m.createdAt])),
      logged: store.eventLog.listSince(memberKeys, cursorSeq),
      previous,
      staleFacts,
      staleClaims: previous ? verifyDossier(previous.dossier, world) : [],
      feedback: store.feedback.recentForTopic(topic.id, FEEDBACK_IN_PROMPTS),
    });
    if (isEmptyDelta(delta)) {
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
      context: this.deps.contexts.forTopic(topic.id),
    };
  }

  /** New version, summary mirror, digest cursor and fact closes land together or not at all. */
  private save(input: DossierUpdateInput, result: DossierUpdateResult): void {
    const { store, tally } = this.deps;
    const at = this.deps.now().toISOString();
    const topicId = input.topic.id;
    const version = (input.previous?.version ?? 0) + 1;
    store.transaction(() => {
      store.dossiers.add({
        topicId,
        version,
        dossier: result.dossier,
        flags: result.flags,
        inputHash: result.inputHash,
        throughSeq: input.delta.toSeq,
        model: result.model,
        createdAt: at,
      });
      store.topics.updateSummary(topicId, result.dossier.summary, result.inputHash, at);
      store.cursors.advance({ kind: 'digest', scope: topicId, seq: input.delta.toSeq, dossierVersion: version, updatedAt: at });
      for (const close of result.closeFacts) {
        this.deps.facts.close(close.factId, close.reason, at);
        tally.facts.invalidated += 1;
      }
      store.facts.markVerified(result.confirmedFactIds, at);
      tally.facts.confirmed += result.confirmedFactIds.length;
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
    if (input.previous?.inputHash === agent.dossierInputHash(input)) {
      budget.skipUnchanged('dossier_update');
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
