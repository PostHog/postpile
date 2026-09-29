import {
  agentCallSummary,
  ALL_AGENT_JOBS,
  rateLimitSourceFromErrors,
  splitAgentOffErrors,
  type AgentCallStats,
  type SyncOptions,
  type SyncProgress,
  type SyncReport,
} from '@postpile/core';
import { noteSyncStart } from './actions/inbox-cleanup.ts';
import { AgentBudget } from './budget.ts';
import { reviveRetiredTopics } from './consolidation/revive.ts';
import type { DigestTally } from './digest/deps.ts';
import { Digester } from './digest/digester.ts';
import { errorText } from './errors.ts';
import { saveLastSyncReport, syncReportLogLines } from './last-sync-report.ts';
import type { GitHubSync } from './github-sync.ts';
import type { MarkReadQueue } from './mark-read-queue.ts';
import { FactVerifier } from './memory/fact-verifier.ts';
import { emptyFactCounts } from './memory/fact-writer.ts';
import { advanceSeenFromGitHub } from './memory/seen-from-github.ts';
import { PhaseClock } from './phase-clock.ts';
import type { RunDeps } from './run-deps.ts';
import { runTelemetry } from './run-deps.ts';
import { hasCompletedFirstSync, markFirstSyncCompleted } from './telemetry/first-sync.ts';

function emptyReport(startedAt: string, tally: DigestTally, errors: string[]): SyncReport {
  return {
    startedAt,
    finishedAt: startedAt,
    notificationsNotModified: false,
    threads: 0,
    prsFetched: 0,
    prsSkipped: 0,
    prsPulledIn: 0,
    prsFound: 0,
    newEvents: 0,
    agentCalls: 0,
    agentCallStats: { total: 0, byKind: {} },
    dossiersUpdated: 0,
    facts: tally.facts,
    errors,
  };
}

/** What progress() reads while a sync runs. */
interface LiveSync {
  startedAt: string;
  phases: PhaseClock;
  budget: AgentBudget;
  stats: AgentCallStats;
}

/** One sync: fetch -> verify facts -> agent digest. Tiles are derived on read. */
export class SyncRun {
  private live: LiveSync | null = null;
  /** The first sync in this process is "start" (the app's own auto-sync); every later one is "manual" ("Sync now"). */
  private syncedOnceInProcess = false;

  constructor(
    private readonly deps: RunDeps,
    private readonly github: GitHubSync,
    private readonly markReadQueue: MarkReadQueue,
    private readonly log: (line: string) => void = (line) => console.log(line),
  ) {}

  /**
   * The running sync, null between syncs. Planned is what the budget granted
   * so far, so it grows as later phases plan their calls; done counts calls
   * that came back, failed ones included.
   */
  progress(): SyncProgress | null {
    if (!this.live) {
      return null;
    }
    return {
      startedAt: this.live.startedAt,
      running: this.live.phases.running(),
      agentCallsDone: this.live.stats.total,
      agentCallsPlanned: this.live.budget.granted(),
    };
  }

  async run(options: SyncOptions): Promise<SyncReport> {
    const { store, now, callLog } = this.deps;
    const startedAt = now().toISOString();
    const errors: string[] = [];
    const tally: DigestTally = { dossiersUpdated: 0, facts: emptyFactCounts() };
    const report = emptyReport(startedAt, tally, errors);
    report.agentCallStats = callLog.begin(`sync:${startedAt}`);
    noteSyncStart(store, startedAt);
    this.log(`sync: started (max agent calls ${options.maxAgentCalls ?? 'unlimited'})`);
    const phases = new PhaseClock(now);
    const budget = new AgentBudget(options.maxAgentCalls ?? Number.POSITIVE_INFINITY, report.agentCallStats);
    this.live = { startedAt, phases, budget, stats: report.agentCallStats };
    try {
      const fetched = await phases.time('fetch', () => this.github.run(options.maxPrs ?? Number.POSITIVE_INFINITY));
      report.notificationsNotModified = fetched.notModified;
      report.threads = fetched.threads;
      report.prsFetched = fetched.prsFetched;
      report.prsSkipped = fetched.prsSkipped;
      report.prsPulledIn = fetched.prsPulledIn;
      report.prsFound = fetched.prsFound;
      report.newEvents = fetched.newEventIds.length;
      errors.push(...fetched.errors);

      new FactVerifier(store, this.deps.facts, now).run(fetched.fetchedPrKeys, tally.facts);
      reviveRetiredTopics(store, fetched.newEventIds, now().toISOString());
      // Without claude the fetch and the rules still ran; the agent jobs would only fail one by one.
      const agentOff = this.deps.agentOff();
      if (agentOff !== null) {
        report.agentOff = agentOff;
        this.log(`sync: agent jobs skipped: ${agentOff}`);
      }
      const digester = new Digester({
        store,
        agent: this.deps.agent,
        contexts: this.deps.contexts,
        budget,
        facts: this.deps.facts,
        viewer: fetched.viewer,
        errors,
        tally,
        now,
      }, phases);
      await digester.run(agentOff === null ? (options.agentJobs ?? ALL_AGENT_JOBS) : []);
      // After the digest, so dossier changes about events already read on GitHub count as seen too.
      advanceSeenFromGitHub(store, fetched.readOnGitHub, now().toISOString());
    } catch (error) {
      errors.push(`sync: ${errorText(error)}`);
      // The stack only goes to the log; the report keeps the message.
      this.log(`sync: failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    } finally {
      callLog.end();
      this.live = null;
    }
    // Mark-reads run in the background; the sync report is where the user hears about them.
    errors.push(...this.markReadQueue.takeNotes());
    // The agent can turn off mid-sync (a usage limit): one line in agentOff, not one error per call.
    const split = splitAgentOffErrors(errors);
    if (split.agentOff) {
      errors.splice(0, errors.length, ...split.errors);
      report.agentOff ??= this.deps.agentOff() ?? 'Agent features are off';
    }
    report.agentCalls = report.agentCallStats.total;
    report.dossiersUpdated = tally.dossiersUpdated;
    report.finishedAt = now().toISOString();
    report.phaseMs = phases.timings();
    for (const line of syncReportLogLines(report)) {
      this.log(line);
    }
    try {
      saveLastSyncReport(store, report);
    } catch (error) {
      this.log(`sync: could not store the report: ${errorText(error)}`);
    }
    this.reportTelemetry(report, options.auto === true);
    return report;
  }

  /** sync_completed always; rate_limited and first_sync_completed only when they apply. Never throws: telemetry never breaks a sync. */
  private reportTelemetry(report: SyncReport, auto: boolean): void {
    try {
      const telemetry = runTelemetry(this.deps);
      const trigger = auto ? 'auto' : this.syncedOnceInProcess ? 'manual' : 'start';
      this.syncedOnceInProcess = true;
      const durationMs = Math.max(0, new Date(report.finishedAt).getTime() - new Date(report.startedAt).getTime());
      const summary = agentCallSummary(report.agentCallStats);
      telemetry.capture('sync_completed', {
        duration_ms: durationMs,
        prs_fetched: report.prsFetched,
        new_events: report.newEvents,
        agent_calls: report.agentCalls,
        agent_failures: summary.failed,
        cost_usd: Math.round(summary.costUsd * 100) / 100,
        stopped_at_cap: summary.stoppedAtCap,
        trigger,
      });
      const rateLimitSource = rateLimitSourceFromErrors(report.errors);
      if (rateLimitSource) {
        telemetry.capture('rate_limited', { source: rateLimitSource });
      }
      if (!hasCompletedFirstSync(this.deps.store)) {
        markFirstSyncCompleted(this.deps.store);
        telemetry.capture('first_sync_completed', {
          prs: report.prsFetched,
          topics: this.deps.store.topics.listActive().length,
          duration_ms: durationMs,
          agent_calls: report.agentCalls,
        });
      }
    } catch (error) {
      this.log(`sync: telemetry failed: ${errorText(error)}`);
    }
  }
}
