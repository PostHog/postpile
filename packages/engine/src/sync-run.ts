import {
  agentCallSummary,
  ALL_AGENT_JOBS,
  rateLimitSourceFromErrors,
  splitAgentOffErrors,
  SYNC_MAX_PRS,
  type AgentCallStats,
  type AgentJob,
  type PrKey,
  type SyncOptions,
  type SyncProgress,
  type SyncReport,
  type Viewer,
} from '@postpile/core';
import type { CatchUpGate } from './actions/inbox-cleanup.ts';
import { AgentBudget } from './budget.ts';
import { retireFinishedTopics } from './consolidation/retire.ts';
import { withdrawStaleProposals } from './consolidation/withdraw.ts';
import { reviveRetiredTopics, reviveUnreadTopics } from './consolidation/revive.ts';
import type { DigestDeps, DigestTally } from './digest/deps.ts';
import { Digester } from './digest/digester.ts';
import { TopicTidy } from './digest/topic-tidy.ts';
import { errorText } from './errors.ts';
import type { GitHubQuota, QuotaRunStats } from './github-quota.ts';
import { saveLastSyncReport, syncReportLogLines } from './last-sync-report.ts';
import type { GitHubSync, GitHubSyncResult } from './github-sync.ts';
import type { MarkReadQueue } from './mark-read-queue.ts';
import { FactVerifier } from './memory/fact-verifier.ts';
import { emptyFactCounts } from './memory/fact-writer.ts';
import { advanceSeenFromGitHub } from './memory/seen-from-github.ts';
import { PhaseClock } from './phase-clock.ts';
import type { RunDeps } from './run-deps.ts';
import { runTelemetry } from './run-deps.ts';
import { hasCompletedFirstSync, markFirstSyncCompleted } from './telemetry/first-sync.ts';
import { loadViewer } from './viewer-meta.ts';
import type { QuietReads } from './writes/quiet-reads.ts';

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
    topicsRetired: 0,
  };
}

/**
 * Dev only (`pnpm cli simulate-start`): a digest over what is stored, as if
 * a sync had just fetched `prKeys`. No GitHub call at all.
 */
export interface DigestStoredOptions {
  /** The PRs to treat as just fetched: facts about them are verified and "since you last looked" moves for them. */
  prKeys: PrKey[];
  /**
   * The ones the sync picked from the inbox: their events count as new. A
   * real sync reports new events only for those; found PRs and stack layers
   * are stored without (GitHubSync.run).
   */
  pingedKeys: PrKey[];
  maxAgentCalls?: number;
  agentJobs?: AgentJob[];
}

/** The part of a fetch the digest reads. */
type FetchedForDigest = Pick<GitHubSyncResult, 'viewer' | 'fetchedPrKeys' | 'newEventIds' | 'readOnGitHub'>;

/** A sync the inbox catch-up held after its fetch: what it fetched, and how it was asked to run. */
interface HeldSync {
  fetched: FetchedForDigest;
  options: SyncOptions;
}

function union<T>(a: T[], b: T[]): T[] {
  return [...new Set([...a, ...b])];
}

/** What a held sync fetched counts for the sync that resumes it: its PRs fetched, its events new. */
function withHeld(fetched: FetchedForDigest, held: HeldSync | null): FetchedForDigest {
  if (held === null) {
    return fetched;
  }
  return {
    viewer: fetched.viewer,
    fetchedPrKeys: union(held.fetched.fetchedPrKeys, fetched.fetchedPrKeys),
    newEventIds: union(held.fetched.newEventIds, fetched.newEventIds),
    readOnGitHub: union(held.fetched.readOnGitHub, fetched.readOnGitHub),
  };
}

/** What progress() reads while a sync runs. */
interface LiveSync {
  startedAt: string;
  phases: PhaseClock;
  budget: AgentBudget;
  stats: AgentCallStats;
  fromGitHub: SyncProgress['fromGitHub'];
}

/**
 * One sync: fetch -> verify facts -> agent digest -> mark threads read that
 * are obviously clearable ("Handled quietly") -> retire finished topics ->
 * bring back retired topics with an unread thread.
 * Tiles are derived on read. When the inbox catch-up's start dialog is due,
 * the sync stops after the fetch and the rest waits for its answer: the next
 * sync (which the answer starts) fetches again and digests both fetches.
 */
export class SyncRun {
  private live: LiveSync | null = null;
  /** Set while the inbox catch-up holds the last sync after its fetch (DESIGN.md "Inbox cleanup" › Before agent work). */
  private held: HeldSync | null = null;
  /** The first sync in this process is "start" (the app's own auto-sync); every later one is "manual" ("Sync now"). */
  private syncedOnceInProcess = false;

  constructor(
    private readonly deps: RunDeps,
    private readonly github: GitHubSync,
    private readonly markReadQueue: MarkReadQueue,
    private readonly quota: GitHubQuota,
    private readonly quietReads: QuietReads,
    private readonly catchUpGate: CatchUpGate,
    private readonly log: (line: string) => void = (line) => console.log(line),
    /** Told after each sync that ran to the end, next to sync_completed (not for a crashed or blocked one). */
    private readonly onCompleted: () => void = () => {},
  ) {}

  /**
   * After the digest (the events agent judged the new quiet activity), on
   * fresh threads and snapshots, with every event and read time of this sync
   * counted. The live poll runs the same pass after each cycle that stored a
   * change.
   */
  private async handleQuietly(errors: string[]): Promise<void> {
    const quiet = await this.quietReads.run('sync');
    errors.push(...quiet.errors);
  }

  /**
   * Everything a sync does between the fetch and the quiet reads: verify
   * facts about the fetched PRs, the agent digest, bring back retired topics
   * with new loud events, move "since you last looked" for what was read on
   * GitHub. The full sync and digestStored share it, so both run the same
   * pipeline.
   */
  private digestDeps(viewer: Viewer, run: { budget: AgentBudget; tally: DigestTally; errors: string[] }): DigestDeps {
    return {
      store: this.deps.store,
      agent: this.deps.agent,
      contexts: this.deps.contexts,
      budget: run.budget,
      facts: this.deps.facts,
      viewer,
      errors: run.errors,
      tally: run.tally,
      now: this.deps.now,
      onGlancesStored: (prKeys) => this.deps.glancePings?.afterGlances(prKeys),
      onEventsRaised: async (events) => (await this.deps.raisedPings?.afterRaised(events, viewer)) ?? [],
      topicDigest: this.deps.topicDigest ?? false,
    };
  }

  /**
   * The one-time topic tidy after an upgrade, first thing in a full sync: it
   * reads only stored topics and PRs, so it need not wait for the fetch, and
   * the app's cover goes up as the sync starts instead of half a minute in,
   * while the old topics took clicks. The digest's own call stays for a
   * store without a viewer yet and for digestStored; once done it is a no-op.
   * Returns true when it tried: the digest then leaves the tidy alone, so a
   * failed call waits for the next full sync instead of a second Opus call
   * in this one.
   */
  private async tidyFirst(agentJobs: AgentJob[] | undefined, run: { phases: PhaseClock; budget: AgentBudget; tally: DigestTally; errors: string[] }): Promise<boolean> {
    const viewer = loadViewer(this.deps.store);
    if (viewer === null || this.deps.agentOff() !== null || !(agentJobs ?? ALL_AGENT_JOBS).includes('topics')) {
      return false;
    }
    const tidy = new TopicTidy(this.digestDeps(viewer, run));
    if (!tidy.callsAgent()) {
      return false;
    }
    await run.phases.time('tidy', () => tidy.runOnce());
    return true;
  }

  private async digest(
    fetched: FetchedForDigest,
    agentJobs: AgentJob[] | undefined,
    run: { phases: PhaseClock; budget: AgentBudget; tally: DigestTally; errors: string[]; report: SyncReport; tidyTried: boolean },
  ): Promise<void> {
    const { store, now } = this.deps;
    new FactVerifier(store, this.deps.facts, now).run(fetched.fetchedPrKeys, run.tally.facts);
    // Without claude the fetch and the rules still ran; the agent jobs would only fail one by one.
    const agentOff = this.deps.agentOff();
    if (agentOff !== null) {
      run.report.agentOff = agentOff;
      this.log(`sync: agent jobs skipped: ${agentOff}`);
    }
    const digester = new Digester(this.digestDeps(fetched.viewer, run), run.phases, { tidy: !run.tidyTried });
    await digester.run(agentOff === null ? (agentJobs ?? ALL_AGENT_JOBS) : []);
    // After the digest classified the new events, so one the agent turned quiet brings no retired topic back.
    reviveRetiredTopics(store, fetched.newEventIds, now().toISOString());
    // After the digest, so dossier changes about events already read on GitHub count as seen too.
    advanceSeenFromGitHub(store, fetched.readOnGitHub, now().toISOString());
  }

  /** The stored PRs as a fetch would have reported them: events of the pinged ones are new, read state is already stored. */
  private storedAsFetched(options: DigestStoredOptions): FetchedForDigest {
    const { store } = this.deps;
    const viewer = loadViewer(store);
    if (!viewer) {
      throw new Error('no viewer stored: digestStored needs a database that synced once');
    }
    const newEventIds = [...store.events.listForPrs(options.pingedKeys).values()].flatMap((events) => events.map((event) => event.id));
    return { viewer, fetchedPrKeys: options.prKeys, newEventIds, readOnGitHub: options.prKeys };
  }

  /** The agent can turn off mid-run (a usage limit): one line in agentOff, not one error per call. */
  private foldAgentOffErrors(report: SyncReport): void {
    const split = splitAgentOffErrors(report.errors);
    if (split.agentOff) {
      report.errors.splice(0, report.errors.length, ...split.errors);
      report.agentOff ??= this.deps.agentOff() ?? 'Agent features are off';
    }
  }

  /**
   * Dev only (`pnpm cli simulate-start`): the agent digest and the retire
   * steps of a sync, on what is stored, as if a sync had just fetched
   * `prKeys`. Never asks GitHub: no fetch and no quiet reads (they write to
   * GitHub). No telemetry and no stored sync report. Errors land in the
   * report as in a sync, so one failed round does not end the simulation.
   */
  async digestStored(options: DigestStoredOptions): Promise<SyncReport> {
    const { store, now, callLog } = this.deps;
    const startedAt = now().toISOString();
    const errors: string[] = [];
    const tally: DigestTally = { dossiersUpdated: 0, facts: emptyFactCounts() };
    const report = emptyReport(startedAt, tally, errors);
    report.agentCallStats = callLog.begin(`digest-stored:${startedAt}`);
    const phases = new PhaseClock(now);
    const budget = new AgentBudget(options.maxAgentCalls ?? Number.POSITIVE_INFINITY, report.agentCallStats);
    try {
      const fetched = this.storedAsFetched(options);
      report.prsFetched = options.prKeys.length;
      report.newEvents = fetched.newEventIds.length;
      await this.digest(fetched, options.agentJobs, { phases, budget, tally, errors, report, tidyTried: false });
      report.topicsRetired = retireFinishedTopics(store, now().toISOString());
      reviveUnreadTopics(store, now().toISOString(), false);
      withdrawStaleProposals(store, now().toISOString());
    } catch (error) {
      errors.push(`digest: ${errorText(error)}`);
      this.log(`digest: failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    } finally {
      callLog.end();
    }
    this.foldAgentOffErrors(report);
    report.agentCalls = report.agentCallStats.total;
    report.dossiersUpdated = tally.dossiersUpdated;
    report.finishedAt = now().toISOString();
    report.phaseMs = phases.timings();
    return report;
  }

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
      fromGitHub: this.live.fromGitHub,
      agentCallStats: this.live.stats,
    };
  }

  /** A sync waits for the inbox catch-up's answer: no agent work, no poll, until it resumes. */
  holding(): boolean {
    return this.held !== null;
  }

  /** How the held sync was asked to run, for the one that resumes it. */
  heldOptions(): SyncOptions | null {
    return this.held?.options ?? null;
  }

  async run(options: SyncOptions): Promise<SyncReport> {
    const { store, now, callLog } = this.deps;
    const startedAt = now().toISOString();
    const errors: string[] = [];
    // Set when the sync threw halfway; telemetry reports it as sync_failed.
    let crashed = false;
    // Set when the inbox catch-up held it after the fetch.
    let held = false;
    const tally: DigestTally = { dossiersUpdated: 0, facts: emptyFactCounts() };
    const report = emptyReport(startedAt, tally, errors);
    report.agentCallStats = callLog.begin(`sync:${startedAt}`);
    this.catchUpGate.noteStart(startedAt);
    this.log(`sync: started (max agent calls ${options.maxAgentCalls ?? 'unlimited'})`);
    // Only the hourly auto sync waits for a low quota; a sync the user or the app start asked for runs anyway.
    if (!this.quota.allowsBackground()) {
      this.log(`sync: GitHub quota low (${this.quota.describe()}), running anyway: not a background sync`);
    }
    this.quota.startRun();
    const phases = new PhaseClock(now);
    const budget = new AgentBudget(options.maxAgentCalls ?? Number.POSITIVE_INFINITY, report.agentCallStats);
    const live: LiveSync = { startedAt, phases, budget, stats: report.agentCallStats, fromGitHub: null };
    this.live = live;
    try {
      const tidyTried = await this.tidyFirst(options.agentJobs, { phases, budget, tally, errors });
      // The first sync into an empty store is a baseline: none of it is news to ping about.
      const firstLook = store.notifications.list().length === 0;
      const fetched = await phases.time('fetch', () => this.github.run(options.maxPrs ?? SYNC_MAX_PRS));
      report.notificationsNotModified = fetched.notModified;
      report.threads = fetched.threads;
      report.prsFetched = fetched.prsFetched;
      report.prsSkipped = fetched.prsSkipped;
      report.prsPulledIn = fetched.prsPulledIn;
      report.prsFound = fetched.prsFound;
      report.newEvents = fetched.newEventIds.length;
      errors.push(...fetched.errors);
      // A reply the sync stored first pings through the next poll cycle, once its thread is unread.
      if (!firstLook) {
        this.deps.pingDecider?.keepSyncedNews(fetched.fetchedPrKeys, fetched.newEventIds);
      }
      // The start dialog is due: the agent work waits for its answer, which resumes the sync (fetching
      // again is cheap: unchanged PRs are skipped, and the bulk mark-reads show up in the inbox).
      const forDigest = withHeld(fetched, this.held);
      // What the digest works on: a resumed sync also digests the fetch it was held after.
      live.fromGitHub = { prsFetched: forDigest.fetchedPrKeys.length, newEvents: forDigest.newEventIds.length };
      held = this.catchUpGate.holds();
      this.held = held ? { fetched: forDigest, options } : null;
      if (held) {
        report.heldForCatchUp = true;
        this.log('sync: held after the fetch until the inbox catch-up dialog is answered');
      } else {
        await this.afterFetch(forDigest, options, { phases, budget, tally, errors, report, tidyTried });
      }
    } catch (error) {
      crashed = true;
      errors.push(`sync: ${errorText(error)}`);
      // The stack only goes to the log; the report keeps the message.
      this.log(`sync: failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    } finally {
      callLog.end();
      this.live = null;
    }
    return this.finishRun(report, phases, tally, options, crashed, held);
  }

  /** Everything after the fetch: the agent digest, the quiet reads, then the retire steps. */
  private async afterFetch(
    fetched: FetchedForDigest,
    options: SyncOptions,
    run: { phases: PhaseClock; budget: AgentBudget; tally: DigestTally; errors: string[]; report: SyncReport; tidyTried: boolean },
  ): Promise<void> {
    const { store, now } = this.deps;
    await this.digest(fetched, options.agentJobs, run);
    // Before the retire step: what PostPile clears by itself no longer holds a finished topic.
    await this.handleQuietly(run.errors);
    // Last, so the new events, what was read on GitHub and the quiet reads all count.
    run.report.topicsRetired = retireFinishedTopics(store, now().toISOString());
    // A finished topic never holds a thread unread on GitHub.
    // After the quiet reads, from the unread state they left: a failed or capped write brings the topic back.
    reviveUnreadTopics(store, now().toISOString(), false);
    // Cheap, no agent call: catches proposals about topics that left the sidebar by any path.
    withdrawStaleProposals(store, now().toISOString());
  }

  /**
   * The report's totals, the log lines, the stored report and telemetry. A
   * held sync sends no telemetry: the sync that resumes it is the one that
   * completes (and counts as the start sync).
   */
  private finishRun(report: SyncReport, phases: PhaseClock, tally: DigestTally, options: SyncOptions, crashed: boolean, held: boolean): SyncReport {
    const { store, now } = this.deps;
    const { errors } = report;
    // Mark-reads run in the background; the sync report is where the user hears about them.
    errors.push(...this.markReadQueue.takeNotes());
    this.foldAgentOffErrors(report);
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
    if (!held) {
      this.reportTelemetry(report, options.auto === true, crashed, this.quota.runStats());
    }
    return report;
  }

  /**
   * sync_completed for a sync that ran to the end, sync_failed for one that
   * threw halfway (it used to count as completed, so failed syncs never
   * showed); rate_limited and first_sync_completed only when they apply.
   * Never throws: telemetry never breaks a sync.
   */
  private reportTelemetry(report: SyncReport, auto: boolean, crashed: boolean, quota: QuotaRunStats): void {
    try {
      const telemetry = runTelemetry(this.deps);
      const trigger = auto ? 'auto' : this.syncedOnceInProcess ? 'manual' : 'start';
      this.syncedOnceInProcess = true;
      const rateLimitSource = rateLimitSourceFromErrors(report.errors);
      if (rateLimitSource) {
        telemetry.capture('rate_limited', { source: rateLimitSource, where: 'sync' });
      }
      if (crashed) {
        telemetry.capture('sync_failed', { error_kind: rateLimitSource ? 'rate_limited' : 'other' });
        return;
      }
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
        gh_requests: quota.requests,
        // Absent, not a made-up number, when no answer during the sync carried that limit.
        ...(quota.lowestPercent.core !== undefined ? { gh_core_remaining_pct: quota.lowestPercent.core } : {}),
        ...(quota.lowestPercent.graphql !== undefined ? { gh_graphql_remaining_pct: quota.lowestPercent.graphql } : {}),
      });
      if (!hasCompletedFirstSync(this.deps.store)) {
        markFirstSyncCompleted(this.deps.store);
        telemetry.capture('first_sync_completed', {
          prs: report.prsFetched,
          topics: this.deps.store.topics.listActive().length,
          duration_ms: durationMs,
          agent_calls: report.agentCalls,
        });
      }
      this.onCompleted();
    } catch (error) {
      this.log(`sync: telemetry failed: ${errorText(error)}`);
    }
  }
}
