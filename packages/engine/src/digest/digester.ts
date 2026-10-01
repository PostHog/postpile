import type { AgentJob, SyncPhase } from '@postpile/core';
import type { PhaseClock } from '../phase-clock.ts';
import type { DigestDeps } from './deps.ts';
import { DossierUpdater, type DossierRun } from './dossiers.ts';
import { EventBatchClassifier } from './event-batches.ts';
import { FactReconciler } from './fact-reconcile.ts';
import { GlanceBatchWriter } from './glance-batches.ts';
import { SetGrouper } from './set-grouping.ts';
import { TopicAssigner } from './topic-assignment.ts';
import { TopicTidy } from './topic-tidy.ts';
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
 * dossier, the fact reconcile and the driver refresh wait for all dossiers,
 * sets wait for the glances (they read each PR's risk). Event
 * classification reads none of them, so it starts right away.
 *
 * The runner's limiter decides how many calls run at once. budget.take is
 * synchronous, so a capped budget is spent in the order jobs ask: topics,
 * dossiers, events, then glances as their dossiers land, then sets and fact
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
    // Once after an upgrade that changed how topics are cut, before the assignment places the PRs it split out.
    await this.job(jobs, 'topics', 'topics', async () => {
      await new TopicTidy(this.deps).runOnce();
      await new TopicAssigner(this.deps).run();
    });
    const dossiers = jobs.includes('dossiers') ? new DossierUpdater(this.deps, { withGlances: jobs.includes('glances'), withSets: jobs.includes('sets') && jobs.includes('glances') }).start() : NO_DOSSIERS;
    const dossiersDone = this.job(jobs, 'dossiers', 'dossiers', async () => {
      await dossiers.done;
    });
    const facts = dossiers.done.then((candidates) =>
      this.job(jobs, 'dossiers', 'facts', () => new FactReconciler(this.deps).run(candidates)),
    );
    // After the dossiers: a dossier's driver wins over the most frequent author.
    const roles = dossiers.done.then(() => refreshDriversAndRoles(this.deps));
    const events = this.job(jobs, 'events', 'events', () => new EventBatchClassifier(this.deps).run());
    const glances = this.job(jobs, 'glances', 'glances', () => new GlanceBatchWriter(this.deps).run(dossiers));
    // After the glances: a set keeps PRs of similar risk, and the risk comes from the glance. After the
    // dossiers too: a topic digest may carry the topic's set changes.
    const sets = Promise.all([glances, dossiersDone]).then(() => this.job(jobs, 'sets', 'sets', () => new SetGrouper(this.deps).run()));
    await Promise.all([dossiersDone, facts, roles, sets, events, glances]);
  }
}
