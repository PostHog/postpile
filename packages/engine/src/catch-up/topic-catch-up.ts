import { effectiveLoudness, emptyAgentCallStats, GLANCE_BATCH_SIZE, type AgentCallStats, type PrKey, type Viewer } from '@postpile/core';
import { AgentBudget } from '../budget.ts';
import { Board } from '../board.ts';
import type { DigestDeps } from '../digest/deps.ts';
import { DossierUpdater } from '../digest/dossiers.ts';
import { EventBatchClassifier } from '../digest/event-batches.ts';
import { FactReconciler } from '../digest/fact-reconcile.ts';
import { GlanceBatchWriter } from '../digest/glance-batches.ts';
import { refreshDriversAndRoles } from '../digest/topic-roles.ts';
import { glanceTargetKeys } from '../glance-inputs.ts';
import { emptyFactCounts } from '../memory/fact-writer.ts';
import { runTelemetry, type RunDeps } from '../run-deps.ts';
import { loadViewer } from '../viewer-meta.ts';
import { errorText } from '../errors.ts';
import type { CatchUpCap } from './catch-up-cap.ts';

/**
 * Topics a poll cycle's PRs need a catch-up run for: a PR with a new loud
 * event (its dossier is behind), or a PR that should have a glance and has
 * none yet (new to the app). Quiet news (a bot comment, CI) waits for the
 * next full sync. Null is the virtual Unsorted topic.
 */
export function topicsToCatchUp(board: Board, fetched: PrKey[], newEventIds: string[], hasGlance: (key: PrKey) => boolean): (string | null)[] {
  const fresh = new Set(newEventIds);
  const wanted = glanceTargetKeys(board);
  const topics = new Set<string | null>();
  for (const key of fetched) {
    const loud = (board.events.get(key) ?? []).some((event) => fresh.has(event.id) && effectiveLoudness(event) === 'loud');
    const missing = wanted.has(key) && !hasGlance(key);
    if (loud || missing) {
      topics.add(board.memberships.get(key)?.topicId ?? null);
    }
  }
  return [...topics];
}

/**
 * Calls one run may make: the dossier update, the event second opinion,
 * a fact reconcile, and each glance batch with its retry.
 */
export function catchUpCallsPerRun(glanceTargets: number): number {
  return 3 + 2 * Math.ceil(glanceTargets / GLANCE_BATCH_SIZE);
}

function statsLine(stats: AgentCallStats): string {
  const kinds = Object.entries(stats.byKind).map(([kind, counts]) => `${kind} ${counts.calls}`);
  return kinds.length > 0 ? kinds.join(', ') : 'no calls';
}

/**
 * The digest of a full sync, for one topic, right after the poll brought news
 * (DESIGN.md "Glance catch-up"). The same jobs in the same order: the
 * topic's dossier update from the new events, the event second opinion, then
 * glances for its PRs that are missing or stale once the dossier landed (with
 * the glance writer's retry batch), then the fact reconcile for what the
 * dossier produced. Topic assignment already ran in the poll. Sets and stack
 * layers stay with the full sync.
 *
 * Each run has its own budget: a per-run cap from the topic's size, and the
 * daily CatchUpCap on top. Its calls land in their own run (`catchup:<topic>:<time>`),
 * never in a poll cycle's stats.
 */
export class TopicCatchUp {
  constructor(
    private readonly deps: RunDeps,
    private readonly cap: CatchUpCap,
    private readonly log: (line: string) => void,
  ) {}

  private glanceTargetsIn(topicId: string | null): number {
    const board = Board.load(this.deps.store, this.deps.now().toISOString());
    return [...glanceTargetKeys(board)].filter((key) => (board.memberships.get(key)?.topicId ?? null) === topicId).length;
  }

  /** catch_up_ran for every run that got past the agent check. Never throws: telemetry never breaks a run. */
  private reportTelemetry(startedAt: string, stats: AgentCallStats, ok: boolean): void {
    try {
      runTelemetry(this.deps).capture('catch_up_ran', {
        topics: 1,
        agent_calls: stats.total,
        duration_ms: Math.max(0, this.deps.now().getTime() - new Date(startedAt).getTime()),
        ok,
      });
    } catch (error) {
      this.log(`catch-up: telemetry failed: ${errorText(error)}`);
    }
  }

  private async runJobs(topicId: string | null, viewer: Viewer, startedAt: string, stats: AgentCallStats, errors: string[]): Promise<void> {
    const { store, agent, contexts, facts, now, callLog } = this.deps;
    const label = topicId ?? 'unsorted';
    await callLog.withRun(`catchup:${label}:${startedAt}`, stats, async () => {
      const budget = new AgentBudget(catchUpCallsPerRun(this.glanceTargetsIn(topicId)), stats, this.cap);
      const deps: DigestDeps = {
        store,
        agent,
        contexts,
        budget,
        facts,
        viewer,
        errors,
        tally: { dossiersUpdated: 0, facts: emptyFactCounts() },
        now,
        onGlancesStored: (prKeys) => this.deps.glancePings?.afterGlances(prKeys),
        onEventsRaised: async (events) => (await this.deps.raisedPings?.afterRaised(events, viewer)) ?? [],
        topicDigest: this.deps.topicDigest ?? false,
      };
      const scope = { topicId };
      // Budget is taken in this order, like a sync: dossier, events, glances as the dossier lands, reconcile.
      const dossiers = new DossierUpdater(deps).start(scope);
      const events = new EventBatchClassifier(deps).run(scope);
      const glances = new GlanceBatchWriter(deps).run(dossiers, scope);
      const candidates = await dossiers.done;
      await new FactReconciler(deps).run(candidates);
      if (deps.tally.dossiersUpdated > 0) {
        // A new dossier can name a different driver.
        refreshDriversAndRoles(deps);
      }
      await Promise.all([events, glances]);
      const capped = budget.stoppedByDailyCap() ? ', daily cap reached' : '';
      this.log(`catch-up ${label}: ${statsLine(stats)}${capped}${errors.length > 0 ? `; errors: ${errors.join('; ')}` : ''}`);
    });
  }

  async run(topicId: string | null): Promise<void> {
    const viewer = loadViewer(this.deps.store);
    if (!viewer || this.deps.agentOff() !== null) {
      return;
    }
    const startedAt = this.deps.now().toISOString();
    const stats = emptyAgentCallStats();
    const errors: string[] = [];
    let ok = false;
    try {
      await this.runJobs(topicId, viewer, startedAt, stats, errors);
      ok = errors.length === 0;
    } finally {
      this.reportTelemetry(startedAt, stats, ok);
    }
  }
}
