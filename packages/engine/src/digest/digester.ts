import type { AgentJob } from '@postpile/core';
import type { DigestDeps } from './deps.ts';
import { DossierUpdater } from './dossiers.ts';
import { EventBatchClassifier } from './event-batches.ts';
import { FactReconciler } from './fact-reconcile.ts';
import { GlanceBatchWriter } from './glance-batches.ts';
import { SetGrouper } from './set-grouping.ts';
import { TopicAssigner } from './topic-assignment.ts';
import { refreshDriversAndRoles } from './topic-roles.ts';

/**
 * The agentic half of a sync, in dependency order, which is also the order
 * a capped budget is spent in: topics (everything else needs them), dossiers
 * with their fact reconcile, sets, glances (pinged before pulled-in) and a
 * second opinion on loud events not classified yet. Every job skips work whose input did not
 * change, so a quiet sync makes no agent calls.
 */
export class Digester {
  constructor(private readonly deps: DigestDeps) {}

  async run(jobs: AgentJob[]): Promise<void> {
    if (jobs.includes('topics')) {
      await new TopicAssigner(this.deps).run();
    }
    let dossiersSkippedByBudget = new Set<string>();
    if (jobs.includes('dossiers')) {
      const dossiers = await new DossierUpdater(this.deps).run();
      dossiersSkippedByBudget = dossiers.skippedByBudget;
      await new FactReconciler(this.deps).run(dossiers.candidates);
    }
    // After the dossiers: a dossier's driver wins over the most frequent author.
    refreshDriversAndRoles(this.deps);
    if (jobs.includes('sets')) {
      await new SetGrouper(this.deps).run();
    }
    if (jobs.includes('glances')) {
      await new GlanceBatchWriter(this.deps).run(dossiersSkippedByBudget);
    }
    if (jobs.includes('events')) {
      await new EventBatchClassifier(this.deps).run();
    }
  }
}
