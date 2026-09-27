import { GLANCE_BATCH_SIZE, isPinged, planGlanceBatches, type GlanceBatch, type GlanceGap, type PrKey } from '@code-manager/core';
import { Board } from '../board.ts';
import { errorText } from '../errors.ts';
import { GlanceInputs, type GlanceTarget } from '../glance-inputs.ts';
import { chunk } from '../lists.ts';
import type { DigestDeps } from './deps.ts';

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
 * Glances as a view written from the topic dossier: per topic, the PRs whose
 * glance input changed, 18 per call. Pinged PRs go before pulled-in ones and
 * unread tiles first, so a capped budget is spent where the user looks
 * first. Every PR a batch leaves out or answers badly gets one more try in a
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

  private batchesFor(targets: GlanceTarget[], inputs: GlanceInputs): GlanceBatch[] {
    return [...groupByTopic(targets)].flatMap(([topicId, group]) =>
      planGlanceBatches(topicId, inputs.dossierVersion(topicId), group.map((target) => target.item.pr.key)),
    );
  }

  /** Returns the PRs that still need a glance after this batch. */
  private async runBatch(batch: GlanceBatch, inputs: GlanceInputs, byKey: Map<PrKey, GlanceTarget>): Promise<PrKey[]> {
    const { store, agent } = this.deps;
    if (!this.deps.budget.take('glance_batch')) {
      this.markGap(batch.prKeys, 'call_cap', 'The sync stopped at its agent-call cap before this PR.');
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
      for (const key of result.missing) {
        this.lastError.set(key, MISSING_REASON);
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

  private needingGlance(inputs: GlanceInputs, skipTopics: Set<string>): GlanceTarget[] {
    const { store, agent, budget } = this.deps;
    const all = inputs.targets();
    const waiting = all.filter((target) => target.topicId !== null && skipTopics.has(target.topicId));
    this.markGap(
      waiting.map((target) => target.item.pr.key),
      'call_cap',
      'Its topic dossier waits for the next sync (call cap), and the glance with it.',
    );
    const targets = all.filter((target) => target.topicId === null || !skipTopics.has(target.topicId));
    const stored = store.glances.getMany(targets.map((target) => target.item.pr.key));
    return targets.filter((target) => {
      if (stored.get(target.item.pr.key)?.inputHash === inputs.itemHash(agent, target)) {
        budget.skipUnchanged('glance_batch');
        return false;
      }
      return true;
    });
  }

  /** skipTopics: topics whose dossier update was skipped by the budget; glancing them now would pay twice. */
  async run(skipTopics: Set<string>): Promise<void> {
    const { store, viewer, contexts } = this.deps;
    const board = Board.load(store, this.deps.now().toISOString());
    const inputs = new GlanceInputs(store, board, viewer, contexts);
    const needing = this.needingGlance(inputs, skipTopics);
    const byKey = new Map(needing.map((target) => [target.item.pr.key, target]));

    const pinged = needing.filter((target) => isPinged(target.item.provenance));
    const pulledIn = needing.filter((target) => !isPinged(target.item.provenance));
    const missing = [
      ...(await this.runRound(this.batchesFor(pinged, inputs), inputs, byKey)),
      ...(await this.runRound(this.batchesFor(pulledIn, inputs), inputs, byKey)),
    ];
    const stillMissing = await this.runRound(this.retryBatches(missing, inputs, byKey), inputs, byKey);
    for (const key of stillMissing) {
      const detail = this.lastError.get(key) ?? MISSING_REASON;
      this.markGap([key], 'failed', detail);
      this.deps.errors.push(`glance ${key}: ${detail}`);
    }
  }
}
