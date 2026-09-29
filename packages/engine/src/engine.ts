import { tmpdir } from 'node:os';
import type { AgentService } from '@postpile/agent';
import type {
  ListScope,
  ActionLogEntry,
  ActionResult,
  ChatMessage,
  ChatReply,
  ConsolidateOptions,
  ConsolidationReport,
  FactQuery,
  FactView,
  FeedbackInput,
  FinishedTopic,
  GitHubWritesChange,
  GitHubWritesStatus,
  CleanupAge,
  InboxCleanupView,
  PendingWritesResult,
  InstructionsChatReply,
  InstructionsDecision,
  InstructionsProposalReply,
  InstructionsSaveResult,
  InstructionsView,
  LivePollStatus,
  McpConnectFrom,
  McpConnectionView,
  McpLauncher,
  SyncProgress,
  MemoryCorrection,
  MemoryRecheckRequest,
  MemoryRecheckResult,
  MemorySources,
  MemoryTarget,
  PendingProposals,
  PrDetail,
  PrKey,
  RepoOverview,
  SearchResult,
  SetupAcceptRequest,
  SetupAcceptResult,
  SetupChecksView,
  SetupFitRequest,
  SetupFitResult,
  SetupRefineRequest,
  SetupRefineResult,
  SetupStatus,
  SetupSweepView,
  SnoozeCondition,
  SyncOptions,
  SyncReport,
  ToolsView,
  TopicDetail,
  TopicListItem,
  TopicProposalKind,
  ViewerView,
  NotificationDebugRow,
  Timers,
  WorkContextSweepResult,
  WorkContextView,
  WorkThreadForget,
} from '@postpile/core';
import { arch, release } from 'node:os';
import {
  emptyAgentCallStats,
  normalizeRepoScope,
  OFF_POLL_STATUS,
  parsePrKey,
  rateLimitSourceFromErrors,
  snoozeTelemetryBucket,
  systemTimers,
  withQuietRepo,
} from '@postpile/core';
import type { AutoSyncOptions } from './auto-sync.ts';
import { isPostHogMember } from '@postpile/core/telemetry-identity';
import { NoopTelemetry, type Telemetry } from './telemetry/telemetry.ts';
import { loadViewer } from './viewer-meta.ts';
import { GitHubError, type GitHubReader } from '@postpile/github';
import type { Store } from '@postpile/store';
import { ChatActions } from './actions/chat-actions.ts';
import { FeedbackActions } from './actions/feedback-actions.ts';
import { InboxCleanup } from './actions/inbox-cleanup.ts';
import { InstructionsActions } from './actions/instructions-actions.ts';
import { PrActions } from './actions/pr-actions.ts';
import { MemoryActions } from './actions/memory-actions.ts';
import { ProposalActions } from './actions/proposal-actions.ts';
import { ReadMarker } from './actions/read-marker.ts';
import { TileActions } from './actions/tile-actions.ts';
import type { AgentCallLog } from './agent-call-log.ts';
import { AutoSyncSchedule } from './auto-sync.ts';
import { Board } from './board.ts';
import { CatchUpCap } from './catch-up/catch-up-cap.ts';
import { CatchUpQueue } from './catch-up/catch-up-queue.ts';
import { TopicCatchUp } from './catch-up/topic-catch-up.ts';
import { glanceGapKey } from './digest/glance-batches.ts';
import { ConsolidationRun } from './consolidation/consolidation-run.ts';
import { errorText } from './errors.ts';
import { GitHubQuota } from './github-quota.ts';
import { GitHubSync, NO_FOCUS, type PollFocus } from './github-sync.ts';
import type { MarkReadQueue } from './mark-read-queue.ts';
import { McpConnection } from './mcp-connection.ts';
import { InstructionsHistory } from './instructions/history.ts';
import { InstructionsProposer } from './instructions/proposer.ts';
import { LivePoller } from './live/live-poller.ts';
import { PING_DECISIONS_PER_DAY, PingDecider } from './live/ping-decider.ts';
import type { LivePollOptions, PollCycle } from './live/poll-cycle.ts';
import { PollRun } from './live/poll-run.ts';
import { emptyFactCounts, FactWriter } from './memory/fact-writer.ts';
import { MemoryRechecker } from './memory/memory-recheck.ts';
import { MemorySourcesReads } from './memory/memory-sources-reads.ts';
import { PromptContextSource } from './prompt-context.ts';
import { ReadModels } from './read-models.ts';
import { loadRepoSettings, saveRepoSettings } from './repo-settings.ts';
import type { EngineService } from './service.ts';
import { loadLastSyncReport } from './last-sync-report.ts';
import { SetupChecks, systemCommands, type CommandRunner } from './setup/setup-checks.ts';
import { SetupFlow } from './setup/setup-flow.ts';
import { SetupSweep } from './setup/setup-sweep.ts';
import { SyncRun } from './sync-run.ts';
import { TeamMembers } from './team-members.ts';
import { ToolHealth } from './tools/tool-health.ts';
import { claudeDirFromEnv } from './work-context/collector.ts';
import { WorkContextSchedule } from './work-context/schedule.ts';
import { WorkContextSweeper } from './work-context/sweeper.ts';
import type { UserConfigFile } from './user-config.ts';
import { WorkContextMemory } from './work-context/work-context.ts';
import type { GitHubWrites } from './writes/github-writes.ts';
import type { PendingWrites } from './writes/pending-writes.ts';

export interface EngineDeps {
  store: Store;
  reader: GitHubReader;
  /** The only way to GitHub writes: asks the footer lock and logs every call. The queue must use the same one. */
  writes: GitHubWrites;
  agent: AgentService;
  /** Must be the observer the agent service reports its calls to; the run stats come from it. */
  callLog: AgentCallLog;
  markReadQueue: MarkReadQueue;
  /** Mark-reads parked while writes were locked. The queue must park into the same one. */
  pendingWrites: PendingWrites;
  instructionsFile: string;
  now: () => Date;
  /** Clock for the live poll. Defaults to the system timers. */
  timers?: Timers;
  /** Daily cap on ping_decision calls. Defaults to PING_DECISIONS_PER_DAY. */
  pingDecisionsPerDay?: number;
  /**
   * Daily cap on glance catch-up calls (POSTPILE_CATCHUP_CAP). 0 turns
   * catch-up off: new PRs then wait for the next full sync. Missing: 0, so
   * tests opt in; createEngine passes the env value or CATCH_UP_CALLS_PER_DAY.
   */
  catchUpCallsPerDay?: number;
  /** The database folder's lock; released on close. Null in tests and read-only CLI access. */
  dataLock?: { release(): void } | null;
  /** Local Claude Code folder the work context sweep reads. Defaults to POSTPILE_CLAUDE_DIR, else ~/.claude. */
  claudeDir?: string;
  /** The user's config.json (sweep skip list). Null or missing: none, e.g. in tests. */
  userConfig?: UserConfigFile | null;
  /** Sync start, summary and errors. Defaults to console.log, which the desktop app writes to its log file. */
  syncLog?: (line: string) => void;
  /**
   * Runs gh and claude for the setup checks and the MCP connection.
   * createEngine passes the real programs run in the app's own folder; tests
   * pass a fake. Missing: the real programs, run in the temp folder.
   */
  setupCommands?: CommandRunner;
  /**
   * How Claude Code starts PostPile's MCP server (the desktop app knows).
   * Only an `app` launcher lets "Add to Claude Code" run claude. Missing: none,
   * the command is only shown.
   */
  mcpLauncher?: McpLauncher | null;
  /**
   * gh and claude status. Must be the one the token source, fetch and agent
   * runner report to (createEngine wires that). Missing: everything counts as
   * working, for tests that do not care.
   */
  tools?: ToolHealth;
  /** Product analytics (DESIGN.md "Usage analytics"). Defaults to a no-op: never required, safe in every test. */
  telemetry?: Telemetry;
  /** For the app_version person property; the identify call is skipped without one. */
  appVersion?: string;
  /**
   * The GitHub quota the reader's and writer's fetch report to (createEngine
   * wires that). Missing: an empty one on the engine's timers, which stays ok
   * until a test feeds it readings.
   */
  quota?: GitHubQuota;
}

/**
 * proposal_resolved only tracks a topic merge or a rename (DESIGN.md "Agent
 * trust"); new_topic and split have no slot in that event's kind enum, so
 * they are left untracked rather than mapped to something misleading.
 */
function topicProposalTelemetryKind(kind: TopicProposalKind | undefined): 'topic_merge' | 'rename' | null {
  if (kind === 'merge' || kind === 'area_merge') {
    return 'topic_merge';
  }
  return kind === 'rename' ? 'rename' : null;
}

/** EngineService over the store, GitHub and the agent. Each concern lives in its own small class. */
export class Engine implements EngineService {
  private readonly reads: ReadModels;
  private readonly tiles: TileActions;
  private readonly prActions: PrActions;
  private readonly feedback: FeedbackActions;
  private readonly chats: ChatActions;
  private readonly proposals: ProposalActions;
  private readonly memoryActions: MemoryActions;
  private readonly memorySources: MemorySourcesReads;
  private readonly rechecker: MemoryRechecker;
  private readonly instructions: InstructionsActions;
  private readonly syncRun: SyncRun;
  private readonly consolidationRun: ConsolidationRun;
  private readonly pollRun: PollRun;
  private readonly sweeper: WorkContextSweeper;
  private readonly workContext: WorkContextMemory;
  private readonly sweepSchedule: WorkContextSchedule;
  private readonly cleanup: InboxCleanup;
  private readonly setup: SetupFlow;
  private readonly toolHealth: ToolHealth;
  private readonly mcp: McpConnection;
  private syncing: Promise<SyncReport> | null = null;
  private consolidating: Promise<ConsolidationReport> | null = null;
  private polling: Promise<PollCycle> | null = null;
  private livePoller: LivePoller | null = null;
  private autoSync: AutoSyncSchedule | null = null;
  private readonly catchUpCap: CatchUpCap;
  private readonly catchUps: CatchUpQueue;
  private readonly github: GitHubSync;
  private readonly telemetry: Telemetry;
  private readonly quota: GitHubQuota;
  /** What the next poll cycle also looks at, set by refreshOnFocus. */
  private focus: PollFocus = NO_FOCUS;

  constructor(private readonly deps: EngineDeps) {
    const { store, now } = deps;
    this.telemetry = deps.telemetry ?? new NoopTelemetry();
    this.toolHealth = deps.tools ?? ToolHealth.assumeOk(now);
    const timers = deps.timers ?? systemTimers;
    this.quota = deps.quota ?? new GitHubQuota(() => timers.now());
    const agentOff = (): string | null => this.toolHealth.agentOffReason();
    const history = new InstructionsHistory(store, deps.instructionsFile, now);
    const proposer = new InstructionsProposer(store, deps.agent, history);
    this.sweeper = new WorkContextSweeper({
      store,
      agent: deps.agent,
      history,
      claudeDir: deps.claudeDir ?? claudeDirFromEnv(),
      now,
      config: deps.userConfig ?? null,
      agentOff,
    });
    this.workContext = new WorkContextMemory(store, this.sweeper, now);
    this.sweepSchedule = new WorkContextSchedule(this.sweeper, deps.timers ?? systemTimers, now);
    const contexts = new PromptContextSource(store, history, () => this.workContext.promptText());
    this.reads = new ReadModels(store, deps.agent, contexts, now, deps.pendingWrites, {
      agentOff: () => agentOff() !== null,
      catchUp: (topicId) => this.catchUps.stateOf(topicId),
    });
    const log = deps.writes.log;
    const readMarker = new ReadMarker(store, deps.markReadQueue, log, now);
    this.tiles = new TileActions(store, readMarker, now);
    this.prActions = new PrActions(store, deps.writes, deps.agent, contexts, readMarker, now, (key) => this.refreshAfterWrite(key));
    this.feedback = new FeedbackActions(store, readMarker, now);
    this.chats = new ChatActions(store, deps.agent, contexts, now);
    this.proposals = new ProposalActions(store, now);
    this.memoryActions = new MemoryActions(store, now);
    this.memorySources = new MemorySourcesReads(store, now);
    this.rechecker = new MemoryRechecker(store, deps.agent, contexts, this.memorySources, now);
    this.instructions = new InstructionsActions(store, history, proposer, now);
    const runDeps = { store, agent: deps.agent, contexts, callLog: deps.callLog, facts: new FactWriter(store, now), now, agentOff, telemetry: this.telemetry };
    const github = new GitHubSync(store, deps.reader, contexts, now, log, deps.pendingWrites, deps.syncLog ?? ((line) => console.log(line)));
    this.github = github;
    this.syncRun = new SyncRun(runDeps, github, deps.markReadQueue, this.quota, deps.syncLog);
    this.consolidationRun = new ConsolidationRun(runDeps);
    const decider = new PingDecider({
      store,
      agent: deps.agent,
      contexts,
      now,
      capPerDay: deps.pingDecisionsPerDay ?? PING_DECISIONS_PER_DAY,
      agentOff,
    });
    const lineLog = deps.syncLog ?? ((line: string) => console.log(line));
    this.catchUpCap = new CatchUpCap(deps.catchUpCallsPerDay ?? 0, now);
    const topicCatchUp = new TopicCatchUp(runDeps, this.catchUpCap, lineLog);
    // Never beside a full sync or a consolidation: the request is skipped and the sync covers the topic.
    this.catchUps = new CatchUpQueue(
      (topicId) => topicCatchUp.run(topicId),
      () => !this.syncing && !this.consolidating && agentOff() === null,
      lineLog,
    );
    this.pollRun = new PollRun(runDeps, github, decider, (topicIds) => this.requestCatchUps(topicIds));
    this.cleanup = new InboxCleanup(store, deps.writes, deps.pendingWrites, now, () => this.rereadInbox());
    const setupSweep = new SetupSweep({
      store,
      reader: deps.reader,
      agent: deps.agent,
      teamMembers: new TeamMembers(store, deps.reader, now),
      history,
      digest: () => this.workContextDigest(),
      now,
    });
    const commands = deps.setupCommands ?? systemCommands(tmpdir());
    const setupChecks = new SetupChecks(deps.reader, commands);
    this.setup = new SetupFlow(store, deps.agent, history, setupChecks, setupSweep, now);
    this.mcp = new McpConnection({ store, commands, tools: this.toolHealth, launcher: deps.mcpLauncher ?? null, now, telemetry: this.telemetry });
  }

  /** The newest work context digest as the setup sweep reads it: prompt text, version and date. */
  private workContextDigest(): { version: number; createdAt: string; text: string } | null {
    const latest = this.deps.store.workContext.latest();
    const text = this.workContext.promptText();
    return latest && text !== '' ? { version: latest.version, createdAt: latest.createdAt, text } : null;
  }

  /**
   * Right after an approve or comment reached GitHub: one poll cycle that
   * also fetches that PR, so the action's answer already carries GitHub's
   * new review state. It runs as a normal cycle (serialized with sync and
   * consolidation, new events get ping handling). A cycle already running
   * started before the write, so it is waited for first. A failure is
   * logged; the write itself went through.
   */
  private async refreshAfterWrite(key: PrKey): Promise<void> {
    if (this.syncing || this.consolidating) {
      return;
    }
    await this.polling?.catch(() => {});
    this.focus = { threadIds: this.focus.threadIds, prRefs: [...this.focus.prRefs, parsePrKey(key)] };
    try {
      await this.pollOnce();
    } catch (error) {
      (this.deps.syncLog ?? console.log)(`refresh after write: ${key}: ${errorText(error)}`);
    }
  }

  /** Topics the poll brought news for: one catch-up run each, coalesced by the queue. Off with a cap of 0. */
  private requestCatchUps(topicIds: (string | null)[]): void {
    if (this.catchUpCap.perDay === 0) {
      return;
    }
    for (const topicId of topicIds) {
      this.catchUps.request(topicId);
    }
  }

  /** The poll hit GitHub's rate limit: the same event a sync sends, marked as the poll's. Never throws. */
  private reportPollRateLimit(error: unknown): void {
    if (!(error instanceof GitHubError) || !error.rateLimited) {
      return;
    }
    try {
      this.telemetry.capture('rate_limited', { source: rateLimitSourceFromErrors([error.message]) ?? 'rest', where: 'poll' });
    } catch (telemetryError) {
      (this.deps.syncLog ?? console.log)(`poll: telemetry failed: ${errorText(telemetryError)}`);
    }
  }

  /** After a cleanup reached GitHub: one poll cycle, so the threads it read show up as read. */
  private async rereadInbox(): Promise<void> {
    await this.pollOnce();
  }

  /** Settles when every run in the list has, whatever the outcome. */
  private static settled(runs: (Promise<unknown> | null)[]): Promise<void> {
    return Promise.all(runs.map((run) => run?.catch(() => {}))).then(() => {});
  }

  /**
   * A sync while one is running joins the running one. Sync, consolidation
   * and a poll cycle never overlap: sync and consolidation wait for the
   * others, so agent calls land in the right run.
   */
  /**
   * Without a usable gh (missing, logged out, token refused) a sync would only
   * fail: it is skipped with blockedBy set and nothing stored, so the last
   * real sync stays the one the footer shows.
   */
  private async syncIfGhWorks(options: SyncOptions): Promise<SyncReport> {
    const tools = await this.toolHealth.ensureFresh();
    if (!tools.canSync) {
      return this.blockedSyncReport(tools.gh.headline);
    }
    const report = await this.syncRun.run(options);
    this.reportIdentity();
    return report;
  }

  /**
   * Once the viewer's numeric GitHub id is known: switch telemetry from the
   * random install id to the hashed id (aliasing the two), and refresh the
   * person properties. Cheap and idempotent, so it runs after every sync
   * rather than only the first time.
   */
  private reportIdentity(): void {
    const viewer = loadViewer(this.deps.store);
    if (!viewer?.databaseId) {
      return;
    }
    this.telemetry.setViewerIdentity(viewer.databaseId);
    this.telemetry.identifyPerson({
      appVersion: this.deps.appVersion ?? 'unknown',
      osVersion: release(),
      arch: arch(),
      isPosthogMember: isPostHogMember(viewer),
      agentAvailable: this.toolHealth.agentOffReason() === null,
    });
  }

  private blockedSyncReport(reason: string): SyncReport {
    const at = this.deps.now().toISOString();
    (this.deps.syncLog ?? console.log)(`sync: skipped: ${reason}`);
    this.telemetry.capture('sync_failed', { error_kind: 'gh_unavailable' });
    return {
      startedAt: at,
      finishedAt: at,
      notificationsNotModified: false,
      threads: 0,
      prsFetched: 0,
      prsSkipped: 0,
      prsPulledIn: 0,
      prsFound: 0,
      newEvents: 0,
      agentCalls: 0,
      agentCallStats: emptyAgentCallStats(),
      dossiersUpdated: 0,
      facts: emptyFactCounts(),
      errors: [],
      blockedBy: reason,
    };
  }

  sync(options: SyncOptions = {}): Promise<SyncReport> {
    if (!this.syncing) {
      // The sync digests every topic: queued catch-up follow-ups are dropped, running ones waited for.
      this.catchUps.dropQueued();
      const before = Engine.settled([this.consolidating, this.polling, this.catchUps.settled()]);
      // PRs left over by the PR cap bring the next background sync forward.
      let backlog = false;
      this.syncing = before
        .then(() => this.syncIfGhWorks(options))
        .then((report) => {
          backlog = report.prsSkipped > 0;
          return report;
        })
        .finally(() => {
          this.syncing = null;
          this.autoSync?.reschedule(backlog);
          // The poll was blocked while the sync ran; catch up on what happened meanwhile.
          void this.livePoller?.runCycle();
        });
    }
    return this.syncing;
  }

  consolidate(options: ConsolidateOptions = {}): Promise<ConsolidationReport> {
    if (!this.consolidating) {
      const before = Engine.settled([this.syncing, this.polling, this.catchUps.settled()]);
      this.consolidating = before
        .then(() => this.consolidationRun.run(options))
        .finally(() => {
          this.consolidating = null;
        });
    }
    return this.consolidating;
  }

  /**
   * One fast-poll cycle. Blocked, not queued, while a full sync or a
   * consolidation runs: the next cycle comes soon enough. A cycle while one
   * runs joins it.
   */
  pollOnce(): Promise<PollCycle> {
    if (this.syncing) {
      return Promise.resolve({ kind: 'blocked', reason: 'full sync running' });
    }
    if (this.consolidating) {
      return Promise.resolve({ kind: 'blocked', reason: 'consolidation running' });
    }
    // First-run setup is open: no fetch, topic calls, catch-ups or Mac pings before the user has
    // instructions (or skips). Accept's sync, and the start sync after a skip, take over from there.
    if (this.setup.status().needed) {
      return Promise.resolve({ kind: 'blocked', reason: 'setup not finished' });
    }
    // Paused, not failing: no gh process and no request until a due recheck finds gh working again.
    const ghOff = this.toolHealth.ghOffReason();
    if (ghOff !== null) {
      this.toolHealth.recheckIfDue();
      return Promise.resolve({ kind: 'blocked', reason: ghOff });
    }
    if (!this.polling) {
      const focus = this.focus;
      this.focus = NO_FOCUS;
      this.polling = this.pollRun
        .run(focus)
        .catch((error: unknown) => {
          this.reportPollRateLimit(error);
          throw error;
        })
        .finally(() => {
          this.polling = null;
        });
    }
    return this.polling;
  }

  startLivePoll(options: LivePollOptions): void {
    if (this.livePoller) {
      return;
    }
    this.livePoller = new LivePoller(() => this.pollOnce(), this.deps.timers ?? systemTimers, options, this.quota);
    this.livePoller.start();
  }

  stopLivePoll(): void {
    this.livePoller?.stop();
    this.livePoller = null;
  }

  startAutoSync(options: AutoSyncOptions): void {
    if (this.autoSync) {
      return;
    }
    const target = {
      isSyncing: () => this.syncing !== null,
      pausedUntil: () => this.quota.backgroundPausedUntil(),
      sync: (maxAgentCalls: number) => this.sync({ maxAgentCalls, auto: true }),
    };
    this.autoSync = new AutoSyncSchedule(target, this.deps.timers ?? systemTimers, options, this.deps.syncLog ?? ((line) => console.log(line)));
    this.autoSync.start();
  }

  stopAutoSync(): void {
    this.autoSync?.stop();
    this.autoSync = null;
  }

  async retryGlance(prKey: PrKey): Promise<ActionResult> {
    const { store, now } = this.deps;
    const agentOff = this.toolHealth.agentOffReason();
    if (agentOff !== null) {
      return { ok: false, message: `Agent features are off: ${agentOff}`, undoToken: null };
    }
    if (this.catchUpCap.perDay === 0) {
      return { ok: false, message: 'Glance catch-up is off (POSTPILE_CATCHUP_CAP=0); the next sync tries again.', undoToken: null };
    }
    if (this.syncing) {
      return { ok: true, message: 'A sync is running; it retries this glance.', undoToken: null };
    }
    if (this.consolidating) {
      return { ok: false, message: 'Consolidation is running; retry in a moment.', undoToken: null };
    }
    if (this.catchUpCap.remaining() === 0) {
      return { ok: false, message: 'Daily agent limit for glances reached; the next full sync writes it.', undoToken: null };
    }
    if (!store.prs.get(prKey)) {
      return { ok: false, message: `${prKey} is not synced yet.`, undoToken: null };
    }
    const topicId = Board.load(store, now().toISOString()).memberships.get(prKey)?.topicId ?? null;
    // The gap would read "failed" until the run writes a new glance or a new gap.
    store.meta.delete(glanceGapKey(prKey));
    const request = this.catchUps.request(topicId);
    const message = request === 'queued' ? 'Glance queued: its topic is being caught up, one more run follows.' : 'Writing the glance…';
    return { ok: true, message, undoToken: null };
  }

  async refreshOnFocus(prKeys: PrKey[]): Promise<void> {
    if (prKeys.length === 0 || this.syncing || this.consolidating) {
      return;
    }
    const threads = this.deps.store.notifications.getByPrKeys(prKeys);
    this.focus = {
      threadIds: [...threads.values()].map((thread) => thread.id),
      prRefs: prKeys.filter((key) => !threads.has(key)).map(parsePrKey),
    };
    // A cycle already running is joined; the focus then waits for the next one.
    if (this.livePoller) {
      await this.livePoller.runCycle();
    } else {
      await this.pollOnce().catch(() => {});
    }
  }

  /** The poll's own status, plus what the renderer refreshes on (syncs, the next auto sync, catch-up runs) and the GitHub quota while it is low. */
  async livePollStatus(): Promise<LivePollStatus> {
    const poll = this.livePoller?.currentStatus() ?? OFF_POLL_STATUS;
    return {
      ...poll,
      syncRunning: this.syncing !== null,
      nextAutoSyncAt: this.autoSync?.nextSyncAt() ?? null,
      catchUpChanges: this.catchUps.changes(),
      githubQuota: this.quota.view(poll.intervalSeconds),
    };
  }

  async syncProgress(): Promise<SyncProgress | null> {
    return this.syncRun.progress();
  }

  async lastSyncReport(): Promise<SyncReport | null> {
    return loadLastSyncReport(this.deps.store);
  }

  async listTopics(scope?: ListScope): Promise<TopicListItem[]> {
    return this.reads.listTopics(scope);
  }

  async listFinishedTopics(): Promise<FinishedTopic[]> {
    return this.reads.listFinishedTopics();
  }

  async listRepos(): Promise<RepoOverview> {
    return this.reads.repos();
  }

  async setRepoScope(repo: string | null): Promise<RepoOverview> {
    const { store } = this.deps;
    saveRepoSettings(store, { ...loadRepoSettings(store), scope: normalizeRepoScope(repo) });
    return this.reads.repos();
  }

  async setRepoQuiet(repo: string, quiet: boolean): Promise<RepoOverview> {
    const { store } = this.deps;
    saveRepoSettings(store, withQuietRepo(loadRepoSettings(store), repo, quiet));
    return this.reads.repos();
  }

  async getViewer(): Promise<ViewerView> {
    return this.reads.viewer();
  }

  async getTopic(topicId: string): Promise<TopicDetail | null> {
    return this.reads.getTopic(topicId);
  }

  async getPr(prKey: PrKey): Promise<PrDetail | null> {
    return this.reads.getPr(prKey);
  }

  async debugNotifications(limit: number): Promise<NotificationDebugRow[]> {
    return this.reads.debugNotifications(limit);
  }

  async actionLog(limit: number): Promise<ActionLogEntry[]> {
    return this.deps.store.actionLog.listRecent(limit);
  }

  private writesStatus(): GitHubWritesStatus {
    return { ...this.deps.writes.status(), pending: this.deps.pendingWrites.views() };
  }

  async githubWrites(): Promise<GitHubWritesStatus> {
    return this.writesStatus();
  }

  async setGitHubWrites(enabled: boolean): Promise<GitHubWritesChange> {
    const change = this.deps.writes.set(enabled);
    return { ...change, status: this.writesStatus() };
  }

  async sendPendingWrites(): Promise<PendingWritesResult> {
    const hadCleanup = this.deps.pendingWrites.pendingCleanupCutoff() !== null;
    const result = await this.deps.pendingWrites.send(this.deps.markReadQueue, () => this.writesStatus());
    if (hadCleanup && this.deps.pendingWrites.pendingCleanupCutoff() === null) {
      await this.rereadInbox().catch(() => {});
      return { ...result, status: this.writesStatus() };
    }
    return result;
  }

  async inboxCleanup(): Promise<InboxCleanupView> {
    return this.cleanup.view();
  }

  cleanUpInbox(age: CleanupAge): Promise<ActionResult> {
    return this.cleanup.markReadBefore(age);
  }

  async startFresh(): Promise<ActionResult> {
    return this.cleanup.startFresh();
  }

  async clearStartFresh(): Promise<ActionResult> {
    return this.cleanup.clearStartFresh();
  }

  async hideInboxCleanup(): Promise<ActionResult> {
    return this.cleanup.hide();
  }

  async discardPendingWrites(): Promise<PendingWritesResult> {
    return this.deps.pendingWrites.discard(() => this.writesStatus());
  }

  async getChat(tileId: string): Promise<ChatMessage[]> {
    return this.chats.getChat(tileId);
  }

  async approve(prKey: PrKey): Promise<ActionResult> {
    const result = await this.prActions.approve(prKey);
    if (result.ok) {
      // Approve only ever runs from the detail pane's action bar (CLAUDE.md
      // "Approve is final"); was_agent_approved is reserved for a future
      // agent-driven approve, which does not exist yet.
      this.telemetry.capture('pr_approved', { from: 'detail', was_agent_approved: false });
    }
    return result;
  }

  async markRead(tileId: string): Promise<ActionResult> {
    const result = await this.tiles.markRead(tileId);
    if (result.ok) {
      this.telemetry.capture('marked_read', { count: 1, origin: 'tile' });
    }
    return result;
  }

  async markThreadRead(threadId: string): Promise<ActionResult> {
    const result = await this.tiles.markThreadRead(threadId);
    if (result.ok) {
      this.telemetry.capture('marked_read', { count: 1, origin: 'debug' });
    }
    return result;
  }

  async undo(undoToken: string | null): Promise<ActionResult> {
    if (undoToken !== null && this.workContext.isUndo(undoToken)) {
      return this.workContext.undo(undoToken);
    }
    if (undoToken !== null && this.memoryActions.isMemoryUndo(undoToken)) {
      return this.memoryActions.undo(undoToken);
    }
    return this.tiles.undo(undoToken);
  }

  async snooze(tileId: string, condition: SnoozeCondition): Promise<ActionResult> {
    const result = await this.tiles.snooze(tileId, condition);
    if (result.ok) {
      this.telemetry.capture('snoozed', { duration_bucket: snoozeTelemetryBucket(condition, this.deps.now().getTime()) });
    }
    return result;
  }

  async unsnooze(tileId: string): Promise<ActionResult> {
    return this.tiles.unsnooze(tileId);
  }

  draftAsk(prKey: PrKey, person: string, intent: string): Promise<{ body: string }> {
    return this.prActions.draftAsk(prKey, person, intent);
  }

  async sendComment(prKey: PrKey, body: string): Promise<ActionResult> {
    // The only caller is AskComposer (apps/desktop/src/renderer/src/components/AskComposer.tsx).
    const result = await this.prActions.sendComment(prKey, body);
    if (result.ok) {
      this.telemetry.capture('ask_sent', {});
    }
    return result;
  }

  async giveFeedback(input: FeedbackInput): Promise<ActionResult> {
    const result = await this.feedback.giveFeedback(input);
    if (result.ok && input.kind === 'wrong_topic') {
      this.telemetry.capture('wrong_topic_marked', {});
    } else if (result.ok && input.kind === 'not_related') {
      this.telemetry.capture('not_related_marked', {});
    }
    return result;
  }

  async unmuteEvent(eventId: string): Promise<ActionResult> {
    return this.feedback.unmuteEvent(eventId);
  }

  async chat(tileId: string, message: string): Promise<ChatReply> {
    const reply = await this.chats.chat(tileId, message);
    this.telemetry.capture('chat_message_sent', {});
    return reply;
  }

  async decideTailoring(topicId: string, text: string, keep: boolean): Promise<ActionResult> {
    return this.chats.decideTailoring(topicId, text, keep);
  }

  async decideTopicProposal(proposalId: string, accept: boolean): Promise<ActionResult> {
    // Read the kind before deciding: decide() marks the proposal accepted/rejected in place.
    const kind = topicProposalTelemetryKind(this.deps.store.proposals.get(proposalId)?.kind);
    const result = await this.proposals.decide(proposalId, accept);
    if (result.ok && kind) {
      this.telemetry.capture('proposal_resolved', { kind, accepted: accept });
    }
    return result;
  }

  async search(query: string, scope?: ListScope): Promise<SearchResult> {
    return this.reads.search(query, scope);
  }

  async listFacts(query: FactQuery): Promise<FactView[]> {
    return this.reads.listFacts(query);
  }

  async listProposals(): Promise<PendingProposals> {
    return this.memoryActions.listProposals();
  }

  async decideRuleProposal(proposalId: string, accept: boolean): Promise<ActionResult> {
    const result = await this.memoryActions.decideRuleProposal(proposalId, accept);
    if (result.ok) {
      this.telemetry.capture('proposal_resolved', { kind: 'rule', accepted: accept });
    }
    return result;
  }

  async markTopicSeen(topicId: string): Promise<ActionResult> {
    return this.memoryActions.markTopicSeen(topicId);
  }

  async correctMemory(input: MemoryCorrection): Promise<ActionResult> {
    const result = await this.memoryActions.correctMemory(input);
    if (result.ok) {
      this.telemetry.capture('memory_corrected', {});
      if (input.fromRecheck) {
        // The user's decision on a recheck: Accept on "still looks right", "needs a fix" or "no longer holds".
        const outcome = input.kind === 'confirm' ? 'keep' : input.kind === 'fix' ? 'fix' : 'drop';
        this.telemetry.capture('recheck_resolved', { outcome });
      }
    }
    return result;
  }

  async recheckMemory(request: MemoryRecheckRequest): Promise<MemoryRecheckResult> {
    this.telemetry.capture('recheck_requested', {});
    const result = await this.rechecker.recheck(request);
    // Only the agent's proposal; recheck_resolved fires when the user accepts it (correctMemory).
    if (result.status === 'answered') {
      this.telemetry.capture('recheck_proposed', { outcome: result.outcome === 'holds' ? 'keep' : result.outcome });
    }
    return result;
  }

  async getMemorySources(target: MemoryTarget): Promise<MemorySources | null> {
    return this.memorySources.get(target);
  }

  async getInstructions(): Promise<InstructionsView> {
    return this.instructions.view();
  }

  async getInstructionsChat(): Promise<ChatMessage[]> {
    return this.instructions.chatHistory();
  }

  instructionsChat(message: string): Promise<InstructionsChatReply> {
    return this.instructions.chat(message);
  }

  proposeInstructions(sourceChatMessageId: number): Promise<InstructionsProposalReply> {
    return this.instructions.propose(sourceChatMessageId);
  }

  async saveInstructions(decision: InstructionsDecision): Promise<InstructionsSaveResult> {
    const result = await this.instructions.save(decision);
    if (result.ok && result.savedVersion !== null) {
      this.telemetry.capture('instructions_edited', {});
      this.telemetry.capture('proposal_resolved', { kind: 'instructions', accepted: true });
    }
    return result;
  }

  async getWorkContext(): Promise<WorkContextView> {
    return this.workContext.view();
  }

  /** Runs beside syncs on purpose: a sync never waits for the sweep, nor the sweep for a sync. */
  sweepWorkContext(): Promise<WorkContextSweepResult> {
    return this.sweeper.sweep();
  }

  async forgetWorkThread(input: WorkThreadForget): Promise<ActionResult> {
    return this.workContext.forget(input);
  }

  async setSweepSkip(patterns: string[]): Promise<ActionResult> {
    return this.sweeper.saveSkipPatterns(patterns);
  }

  startWorkContextSchedule(): void {
    this.sweepSchedule.start();
  }

  stopWorkContextSchedule(): void {
    this.sweepSchedule.stop();
  }

  async setupStatus(): Promise<SetupStatus> {
    return this.setup.status();
  }

  /** Also refreshes the tool status, so fixing gh or claude during setup counts everywhere. */
  async setupChecks(): Promise<SetupChecksView> {
    await this.toolHealth.check();
    return this.setup.runChecks();
  }

  tools(): Promise<ToolsView> {
    return this.toolHealth.ensureFresh();
  }

  checkTools(): Promise<ToolsView> {
    return this.toolHealth.check();
  }

  mcpConnection(): Promise<McpConnectionView> {
    return this.mcp.view();
  }

  connectMcp(from: McpConnectFrom): Promise<ActionResult> {
    return this.mcp.connect(from);
  }

  async hideMcpConnect(): Promise<ActionResult> {
    return this.mcp.hide();
  }

  async startSetupSweep(): Promise<SetupSweepView> {
    return this.setup.startSweep();
  }

  async setupSweep(): Promise<SetupSweepView | null> {
    return this.setup.sweepView();
  }

  refineSetup(request: SetupRefineRequest): Promise<SetupRefineResult> {
    return this.setup.refine(request);
  }

  async checkSetupFit(request: SetupFitRequest): Promise<SetupFitResult> {
    const result = await this.setup.checkFit(request);
    this.telemetry.capture('setup_fit_checked', { notes: result.notes.length, ok: result.ok });
    return result;
  }

  async acceptSetup(request: SetupAcceptRequest): Promise<SetupAcceptResult> {
    const result = await this.setup.accept(request);
    if (result.ok) {
      this.telemetry.capture('setup_completed', {});
    }
    return result;
  }

  async skipSetup(): Promise<ActionResult> {
    const result = await this.setup.skip();
    if (result.ok) {
      this.telemetry.capture('setup_skipped', {});
    }
    return result;
  }

  flushPendingWrites(): Promise<void> {
    return this.deps.markReadQueue.flush();
  }

  async close(): Promise<void> {
    this.stopLivePoll();
    this.stopAutoSync();
    this.catchUps.dropQueued();
    // A running sweep is not awaited (it can take minutes); its late write fails quietly.
    this.stopWorkContextSchedule();
    await this.polling?.catch(() => {});
    await this.syncing?.catch(() => {});
    await this.consolidating?.catch(() => {});
    await this.catchUps.settled();
    this.deps.store.close();
    this.deps.dataLock?.release();
    // Flushes whatever telemetry is still queued; a no-op when telemetry is off.
    await this.telemetry.shutdown();
  }
}
