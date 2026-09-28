import type { AgentJob } from '@postpile/core';
import type { DigestDeps } from './deps.ts';
import { DossierUpdater, type DossierRun } from './dossiers.ts';
import { EventBatchClassifier } from './event-batches.ts';
import { FactReconciler } from './fact-reconcile.ts';
import { GlanceBatchWriter } from './glance-batches.ts';
import { SetGrouper } from './set-grouping.ts';
import { TopicAssigner } from './topic-assignment.ts';
import { refreshDriversAndRoles } from './topic-roles.ts';

/** Stands in for the dossier job when a sync leaves it out: nothing to wait for. */
const NO_DOSSIERS: DossierRun = {
  skippedByBudget: new Set(),
  settled: () => Promise.resolve(),
  done: Promise.resolve([]),
};

/**
 * The agentic half of a sync. Topics come first, alone: everything else
 * needs them. After that every job runs side by side, and waits only where
 * it reads another job's output: a topic's glances wait for that topic's
 * dossier, the fact reconcile and the driver refresh wait for all dossiers.
 * Sets and event classification read neither, so they start right away.
 *
 * The runner's limiter decides how many calls run at once. budget.take is
 * synchronous, so a capped budget is spent in the order jobs ask: topics,
 * dossiers, sets, events, then glances as their dossiers land, then fact
 * reconcile. Every job skips work whose input did not change, so a quiet
 * sync makes no agent calls.
 */
export class Digester {
  constructor(private readonly deps: DigestDeps) {}

  async run(jobs: AgentJob[]): Promise<void> {
    if (jobs.includes('topics')) {
      await new TopicAssigner(this.deps).run();
    }
    const dossiers = jobs.includes('dossiers') ? new DossierUpdater(this.deps).start() : NO_DOSSIERS;
    const facts = jobs.includes('dossiers')
      ? dossiers.done.then((candidates) => new FactReconciler(this.deps).run(candidates))
      : Promise.resolve();
    // After the dossiers: a dossier's driver wins over the most frequent author.
    const roles = dossiers.done.then(() => refreshDriversAndRoles(this.deps));
    const sets = jobs.includes('sets') ? new SetGrouper(this.deps).run() : Promise.resolve();
    const events = jobs.includes('events') ? new EventBatchClassifier(this.deps).run() : Promise.resolve();
    const glances = jobs.includes('glances') ? new GlanceBatchWriter(this.deps).run(dossiers) : Promise.resolve();
    await Promise.all([facts, roles, sets, events, glances]);
  }
}
