import {
  CHAT_TURNS_IN_DOSSIER_PROMPT,
  dossierContextHash,
  FACTS_IN_DOSSIER_PROMPT,
  STALE_FACTS_IN_DOSSIER_PROMPT,
  type AreaChoice,
  type DossierUpdateInput,
  type DossierUpdateResult,
} from '@postpile/agent';
import {
  isEmptyDelta,
  joinedMembers,
  relationSignals,
  selectTopicDelta,
  verifyDossier,
  verifyFact,
  withoutStaleClaims,
  type DossierVersion,
  type EntityRef,
  type Fact,
  type FactCandidate,
  type PrKey,
  type Topic,
} from '@postpile/core';
import { Board } from '../board.ts';
import { errorText } from '../errors.ts';
import { verifyWorldFor } from '../memory/fact-world.ts';
import { FEEDBACK_IN_PROMPTS } from '../prompt-context.ts';
import type { DigestDeps, TopicScope } from './deps.ts';

/** Versions kept per topic; older ones are pruned on every save. */
export const DOSSIER_VERSIONS_KEPT = 50;

/** New areas one sync may introduce; past it a topic keeps its area (or none) until consolidation tidies up. */
export const MAX_NEW_AREAS_PER_SYNC = 3;

/** Fact candidates one dossier update produced, still to be reconciled. */
export interface TopicCandidates {
  topicId: string;
  candidates: FactCandidate[];
}

/**
 * Dossier updates in flight. start() takes the budget for every update before
 * it returns, so skippedByBudget is complete right away and later jobs spend
 * only what the dossiers left.
 */
export interface DossierRun {
  /** Topics whose update the budget skipped. Their glances wait too, or they would be paid for twice. */
  skippedByBudget: Set<string>;
  /** Settles once this topic's update is stored or failed; right away for a topic without one. Never rejects. */
  settled(topicId: string | null): Promise<void>;
  /** Every update settled, with the fact candidates they produced. */
  done: Promise<TopicCandidates[]>;
}

/** Meta key of the context hash a topic's dossier was last written under. */
export function contextHashKey(topicId: string): string {
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
  private newAreas = 0;

  constructor(private readonly deps: DigestDeps) {}

  /** Areas in use on other active topics, most used first. */
  private areasInUse(topicId: string): AreaChoice[] {
    const counts = new Map<string, number>();
    for (const topic of this.deps.store.topics.listActive()) {
      if (topic.id !== topicId && topic.area) {
        counts.set(topic.area, (counts.get(topic.area) ?? 0) + 1);
      }
    }
    return [...counts].map(([name, topics]) => ({ name, topics })).sort((a, b) => b.topics - a.topics);
  }

  /**
   * The answer's area if it is in use (by name, any case), or new while
   * under the cap; else the topic keeps its area. Areas are read again here:
   * updates run side by side, so another topic may have introduced it.
   */
  private areaFor(input: DossierUpdateInput, answered: string | null): string | null {
    if (answered === null) {
      return input.currentArea;
    }
    const known = this.areasInUse(input.topic.id).find((area) => area.name.toLowerCase() === answered.toLowerCase());
    if (known) {
      return known.name;
    }
    if (input.currentArea?.toLowerCase() === answered.toLowerCase()) {
      return input.currentArea;
    }
    if (this.newAreas >= MAX_NEW_AREAS_PER_SYNC) {
      return input.currentArea;
    }
    this.newAreas += 1;
    return answered;
  }

  /** Every active topic, or only the scope's (none for Unsorted, which has no dossier). */
  private topicsInOrder(scope: TopicScope | null): Topic[] {
    const board = Board.load(this.deps.store, this.deps.now().toISOString());
    const hasUnread = (topic: Topic): boolean =>
      board.tilesForTopic(topic.id).some((tile) => board.stateOf(tile).kind === 'unread');
    const active = this.deps.store.topics.listActive();
    const topics = scope === null ? active : active.filter((topic) => topic.id === scope.topicId);
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

  /**
   * A delta with nothing to read (only CI results or muted events after the
   * cursor) still moves the digest cursor past them. Without it every sync
   * would read the same history again. The dossier version stays.
   */
  private skipPast(topicId: string, cursorSeq: number, toSeq: number, previous: DossierVersion | null): void {
    if (toSeq <= cursorSeq) {
      return;
    }
    const at = this.deps.now().toISOString();
    this.deps.store.cursors.advance({ kind: 'digest', scope: topicId, seq: toSeq, dossierVersion: previous?.version ?? null, updatedAt: at });
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
      this.skipPast(topic.id, cursorSeq, delta.toSeq, previous);
      return null;
    }
    return {
      topic,
      previous,
      delta,
      prs: [...prs.values()],
      knownFacts: this.knownFacts(topic, memberKeys),
      staleFacts,
      chatTurns: store.chat.listUserForTopicSince(topic.id, previous?.createdAt ?? '', CHAT_TURNS_IN_DOSSIER_PROMPT),
      relationSignals: relationSignals({
        viewer: this.deps.viewer,
        prs: [...prs.values()],
        threads: [...store.notifications.getByPrKeys(memberKeys).values()],
        driver: topic.driver,
      }),
      areas: this.areasInUse(topic.id),
      currentArea: topic.area,
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
      store.topics.setArea(topicId, this.areaFor(input, result.area), at);
      store.cursors.advance({ kind: 'digest', scope: topicId, seq: input.delta.toSeq, dossierVersion: version, updatedAt: at });
      store.meta.set(contextHashKey(topicId), dossierContextHash(input.context));
      store.dossiers.prune(topicId, DOSSIER_VERSIONS_KEPT);
      for (const close of result.closeFacts) {
        this.deps.facts.close(close.factId, close.reason, at);
        tally.facts.invalidated += 1;
      }
      this.deps.facts.confirm(result.confirmedFactIds, tally.facts);
      store.facts.markRechecked(input.staleFacts.map((fact) => fact.id), at);
    });
    tally.dossiersUpdated += 1;
  }

  private async update(topic: Topic, candidates: TopicCandidates[], skippedByBudget: Set<string>): Promise<void> {
    const { agent, budget } = this.deps;
    // Everything up to the agent call is synchronous, so budget.take runs in topic order.
    const input = this.input(topic);
    if (!input) {
      return;
    }
    if (!budget.take('dossier_update')) {
      skippedByBudget.add(topic.id);
      return;
    }
    try {
      const result = await agent.updateDossier(input);
      this.save(input, result);
      if (result.facts.length > 0) {
        candidates.push({ topicId: topic.id, candidates: result.facts });
      }
    } catch (error) {
      this.deps.errors.push(`dossier ${topic.id}: ${errorText(error)}`);
    }
  }

  /**
   * Starts every update side by side (the runner's limiter caps how many run
   * at once). A glance catch-up passes its topic as scope.
   */
  start(scope: TopicScope | null = null): DossierRun {
    const candidates: TopicCandidates[] = [];
    const skippedByBudget = new Set<string>();
    const updates = new Map<string, Promise<void>>();
    for (const topic of this.topicsInOrder(scope)) {
      updates.set(topic.id, this.update(topic, candidates, skippedByBudget));
    }
    return {
      skippedByBudget,
      settled: (topicId) => (topicId === null ? Promise.resolve() : (updates.get(topicId) ?? Promise.resolve())),
      done: Promise.all(updates.values()).then(() => candidates),
    };
  }
}
