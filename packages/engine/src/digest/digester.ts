import type { AgentJob, SyncPhase } from '@postpile/core';
import type { PhaseClock } from '../phase-clock.ts';
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
  constructor(
    private readonly deps: DigestDeps,
    private readonly phases: PhaseClock,
  ) {}

  /** Times the job when the sync asked for it; nothing to wait for otherwise. */
  private job(jobs: AgentJob[], job: AgentJob, phase: SyncPhase, work: () => Promise<void>): Promise<void> {
    return jobs.includes(job) ? this.phases.time(phase, work) : Promise.resolve();
  }

  async run(jobs: AgentJob[]): Promise<void> {
    await this.job(jobs, 'topics', 'topics', () => new TopicAssigner(this.deps).run());
    const dossiers = jobs.includes('dossiers') ? new DossierUpdater(this.deps).start() : NO_DOSSIERS;
    const dossiersDone = this.job(jobs, 'dossiers', 'dossiers', async () => {
      await dossiers.done;
    });
    const facts = dossiers.done.then((candidates) =>
      this.job(jobs, 'dossiers', 'facts', () => new FactReconciler(this.deps).run(candidates)),
    );
    // After the dossiers: a dossier's driver wins over the most frequent author.
    const roles = dossiers.done.then(() => refreshDriversAndRoles(this.deps));
    const sets = this.job(jobs, 'sets', 'sets', () => new SetGrouper(this.deps).run());
    const events = this.job(jobs, 'events', 'events', () => new EventBatchClassifier(this.deps).run());
    const glances = this.job(jobs, 'glances', 'glances', () => new GlanceBatchWriter(this.deps).run(dossiers));
    await Promise.all([dossiersDone, facts, roles, sets, events, glances]);
  }
}
