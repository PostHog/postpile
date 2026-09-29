import { GLANCE_BATCH_SIZE, planGlanceBatches, type GlanceBatch, type GlanceGap, type PrKey } from '@postpile/core';
import { Board } from '../board.ts';
import { errorText } from '../errors.ts';
import { GlanceInputs, type GlanceTarget } from '../glance-inputs.ts';
import { chunk } from '../lists.ts';
import type { DigestDeps, TopicScope } from './deps.ts';
import type { DossierRun } from './dossiers.ts';

const MISSING_REASON = 'missing or invalid in the answer';

/** Meta key of a PR's glance gap (GlanceGap JSON); cleared when a glance is stored. */
export function glanceGapKey(prKey: PrKey): string {
  return `glance_gap:${prKey}`;
}

/** Keeps the given order: topics appear in the order of their most urgent PR. */
function groupByTopic(targets: GlanceTarget[]): Map<string | null, GlanceTarget[]> {
  const groups = new Map<string | null, GlanceTarget[]>();
  for (const target of targets) {
    const group = groups.get(target.topicId) ?? [];
    group.push(target);
    groups.set(target.topicId, group);
  }
  return groups;
}

/**
 * Glances as a view written from the topic dossier: per topic, the pinged
 * PRs whose glance input changed, 18 per call, unread tiles first within a
 * topic. A topic's batches start when its dossier update settled, so glances
 * of quick topics run while slow dossiers are still out. Pulled-in stack layers
 * get none. Every PR a batch leaves out or answers badly gets one more try in a
 * retry batch; after that it is an error line and the next sync tries again.
 */
export class GlanceBatchWriter {
  private readonly lastError = new Map<PrKey, string>();

  constructor(private readonly deps: DigestDeps) {}

  private markGap(prKeys: PrKey[], reason: GlanceGap['reason'], detail: string): void {
    const at = this.deps.now().toISOString();
    for (const key of prKeys) {
      const gap: GlanceGap = { reason, detail, at };
      this.deps.store.meta.set(glanceGapKey(key), JSON.stringify(gap));
    }
  }

  /** A call the budget refused: the daily catch-up cap, or the run's own cap. */
  private capGap(prKeys: PrKey[], runCapDetail: string): void {
    if (this.deps.budget.stoppedByDailyCap()) {
      this.markGap(prKeys, 'daily_cap', 'The daily catch-up cap is spent; the next full sync writes it.');
    } else {
      this.markGap(prKeys, 'call_cap', runCapDetail);
    }
  }

  /** Returns the PRs that still need a glance after this batch. */
  private async runBatch(batch: GlanceBatch, inputs: GlanceInputs, byKey: Map<PrKey, GlanceTarget>): Promise<PrKey[]> {
    const { store, agent } = this.deps;
    if (!this.deps.budget.take('glance_batch')) {
      this.capGap(batch.prKeys, 'The run stopped at its agent-call cap before this PR.');
      return [];
    }
    const items = batch.prKeys.flatMap((key) => {
      const target = byKey.get(key);
      return target ? [target.item] : [];
    });
    try {
      const result = await agent.glanceBatch(inputs.batchInput(batch.topicId, items, batch.attempt));
      store.transaction(() => {
        for (const glance of result.glances) {
          store.glances.put(glance);
          store.meta.delete(glanceGapKey(glance.prKey));
        }
      });
      this.deps.onGlancesStored?.(result.glances.map((glance) => glance.prKey));
      for (const key of result.missing) {
        this.lastError.set(key, result.missingWhy?.[key] ?? MISSING_REASON);
      }
      return result.missing;
    } catch (error) {
      for (const key of batch.prKeys) {
        this.lastError.set(key, errorText(error));
      }
      return batch.prKeys;
    }
  }

  /** Runs batches side by side; budget.take is synchronous, so the given order decides who gets the budget. */
  private async runRound(batches: GlanceBatch[], inputs: GlanceInputs, byKey: Map<PrKey, GlanceTarget>): Promise<PrKey[]> {
    const missing = await Promise.all(batches.map((batch) => this.runBatch(batch, inputs, byKey)));
    return missing.flat();
  }

  private retryBatches(missing: PrKey[], inputs: GlanceInputs, byKey: Map<PrKey, GlanceTarget>): GlanceBatch[] {
    const targets = missing.flatMap((key) => byKey.get(key) ?? []);
    return [...groupByTopic(targets)].flatMap(([topicId, group]) =>
      chunk(group, GLANCE_BATCH_SIZE).map(
        (part): GlanceBatch => ({
          topicId,
          dossierVersion: inputs.dossierVersion(topicId),
          prKeys: part.map((target) => target.item.pr.key),
          attempt: 2,
        }),
      ),
    );
  }

  /** Targets outside skipTopics; the ones inside get a call_cap gap. */
  private withoutSkipped(targets: GlanceTarget[], skipTopics: Set<string>): GlanceTarget[] {
    const waiting = targets.filter((target) => target.topicId !== null && skipTopics.has(target.topicId));
    this.capGap(
      waiting.map((target) => target.item.pr.key),
      'Its topic dossier waits for the next sync (call cap), and the glance with it.',
    );
    return targets.filter((target) => target.topicId === null || !skipTopics.has(target.topicId));
  }

  /** Called once the topic's dossier is final: the hash carries its version. */
  private needingGlance(group: GlanceTarget[], inputs: GlanceInputs): GlanceTarget[] {
    const { store, agent, budget } = this.deps;
    const stored = store.glances.getMany(group.map((target) => target.item.pr.key));
    return group.filter((target) => {
      if (stored.get(target.item.pr.key)?.inputHash === inputs.itemHash(agent, target)) {
        budget.skipUnchanged('glance_batch');
        return false;
      }
      return true;
    });
  }

  /**
   * One topic, as soon as its dossier update settled: its batches, then one
   * retry batch for whatever they left out. Returns the PRs still missing.
   */
  private async glanceTopic(
    topicId: string | null,
    group: GlanceTarget[],
    inputs: GlanceInputs,
    byKey: Map<PrKey, GlanceTarget>,
    dossierSettled: Promise<void>,
  ): Promise<PrKey[]> {
    await dossierSettled;
    const needing = this.needingGlance(group, inputs);
    for (const target of needing) {
      byKey.set(target.item.pr.key, target);
    }
    const keys = needing.map((target) => target.item.pr.key);
    const missing = await this.runRound(planGlanceBatches(topicId, inputs.dossierVersion(topicId), keys), inputs, byKey);
    return this.runRound(this.retryBatches(missing, inputs, byKey), inputs, byKey);
  }

  /**
   * dossiers: the running dossier updates. Each topic's glances start as soon
   * as its own dossier settled, not after every dossier; topics whose update
   * the budget skipped get none (glancing them now would pay twice). A glance
   * catch-up run passes its topic as scope: only that topic's PRs.
   */
  async run(dossiers: Pick<DossierRun, 'skippedByBudget' | 'settled'>, scope: TopicScope | null = null): Promise<void> {
    const { store, viewer, contexts } = this.deps;
    const board = Board.load(store, this.deps.now().toISOString());
    const inputs = new GlanceInputs(store, board, viewer, contexts);
    const inScope = inputs.targets().filter((target) => scope === null || target.topicId === scope.topicId);
    const targets = this.withoutSkipped(inScope, dossiers.skippedByBudget);
    const byKey = new Map<PrKey, GlanceTarget>();

    const topics = [...groupByTopic(targets)].map(([topicId, group]) =>
      this.glanceTopic(topicId, group, inputs, byKey, dossiers.settled(topicId)),
    );
    const stillMissing = (await Promise.all(topics)).flat();
    for (const key of stillMissing) {
      const detail = this.lastError.get(key) ?? MISSING_REASON;
      this.markGap([key], 'failed', detail);
      this.deps.errors.push(`glance ${key}: ${detail}`);
    }
  }
}
