import { tmpdir } from 'node:os';
import type { AgentService } from '@postpile/agent';
import type {
  PrOverlapsView,
  ListScope,
  ActionLogEntry,
  ActionResult,
  AgentActionFrom,
  ApprovePrRequest,
  BatchApproveResult,
  PrApproveResult,
  ReviewNoteKind,
  ReviewNoteSource,
  AgentRefreshOptions,
  AgentRefreshResult,
  AgentRefreshTarget,
  TopicChangeRequest,
  TopicChangeResult,
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
  CleanupRequest,
  SafeCleanupRequest,
  InboxCleanupView,
  InterruptionsFrom,
  InterruptionsMode,
  InterruptionsView,
  PendingWritesResult,
  InstructionsChatReply,
  InstructionsDecision,
  InstructionsProposalReply,
  InstructionsSaveResult,
  InstructionsView,
  LessonView,
  LivePollStatus,
  MacNotification,
  McpConnectFrom,
  McpConnectionView,
  McpLauncher,
  SyncProgress,
  RecordedSyncProgress,
  MemoryCorrection,
  MemoryRecheckRequest,
  MemoryRecheckResult,
  MemorySources,
  MemoryTarget,
  PendingProposals,
  PingTarget,
  EventView,
  PrDetail,
  PrNoteRequest,
  PrNoteResult,
  PrNotesView,
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
  TeamRole,
  TeamMembersView,
  TeamRolesView,
  ToolsView,
  TeachLessonResult,
  TopicDetail,
  TopicListItem,
  TopicProposalKind,
  ViewerView,
  NotificationDebugRow,
  GlanceLookResult,
  OpenedReadResult,
  QuietReadView,
  Timers,
  WorkContextSweepResult,
  WorkContextView,
  WorkThreadForget,
  BoardShapeEvent,
  BusyInboxView,
} from '@postpile/core';
import { arch, release } from 'node:os';
import {
  agentApproveRefusal,
  agentApproveSkip,
  agentMarkReadRefusal,
  approvalsSummary,
  CATCH_UP_CONFIRM_EVERY_MS,
  CATCH_UP_PACE_MS,
  driverKind,
  emptyAgentCallStats,
  interruptionsView,
  isBoardFull,
  normalizeRepoScope,
  OFF_POLL_STATUS,
  parsePrKey,
  rateLimitSourceFromErrors,
  snoozeTelemetryBucket,
  systemTimers,
  withHomeTeams,
  withQuietRepo,
} from '@postpile/core';
import { loadAppVersion, saveAppVersion } from './app-version-meta.ts';
import type { AutoSyncOptions } from './auto-sync.ts';
import { isPostHogMember } from '@postpile/core/telemetry-identity';
import { ShedReport } from './telemetry/shed-report.ts';
import { PingSummary } from './telemetry/ping-summary.ts';
import { NoopTelemetry, type Telemetry } from './telemetry/telemetry.ts';
import { loadViewer } from './viewer-meta.ts';
import { muteHoldsNow } from './mute-holds.ts';
import { GitHubError, type GitHubReader } from '@postpile/github';
import { recordedVersion, type Store } from '@postpile/store';
import { ChatActions } from './actions/chat-actions.ts';
import { AgentRefresher, type RefreshRun } from './agent-requests/agent-refresh.ts';
import { answerAgentRequest } from './agent-requests/answer.ts';
import { AgentRequestInbox } from './agent-requests/inbox.ts';
import { OutsideProposals } from './agent-requests/topic-change.ts';
import { NoteCoverReader } from './note-cover.ts';
import { PrNotes } from './pr-notes.ts';
import { FeedbackActions } from './actions/feedback-actions.ts';
import { InboxCleanup } from './actions/inbox-cleanup.ts';
import { failed } from './actions/results.ts';
import { setTopicDriver } from './actions/driver-pick.ts';
import { InstructionsActions } from './actions/instructions-actions.ts';
import { LessonActions } from './actions/lesson-actions.ts';
import { PrActions } from './actions/pr-actions.ts';
import { MemoryActions } from './actions/memory-actions.ts';
import { ProposalActions } from './actions/proposal-actions.ts';
import { ReadMarker } from './actions/read-marker.ts';
import { TileActions } from './actions/tile-actions.ts';
import { OpenedReads } from './actions/opened-reads.ts';
import type { AgentCallLog } from './agent-call-log.ts';
import { AutoSyncSchedule } from './auto-sync.ts';
import { Board } from './board.ts';
import { pendingGlanceKeys } from './glance-inputs.ts';
import { changeTopicStatus } from './topic-status.ts';
import { CatchUpCap } from './catch-up/catch-up-cap.ts';
import { CatchUpQueue } from './catch-up/catch-up-queue.ts';
import { QuietCatchUps } from './catch-up/quiet-catch-ups.ts';
import { TopicCatchUp, type CatchUpTopics } from './catch-up/topic-catch-up.ts';
import { glanceGapKey } from './digest/glance-batches.ts';
import { topicRetireGate } from './consolidation/retire.ts';
import { ConsolidationRun } from './consolidation/consolidation-run.ts';
import { errorText } from './errors.ts';
import { GitHubQuota } from './github-quota.ts';
import { GitHubSync, NO_FOCUS, type PollFocus } from './github-sync.ts';
import type { MarkReadQueue } from './mark-read-queue.ts';
import { McpConnection } from './mcp-connection.ts';
import { InstructionsHistory } from './instructions/history.ts';
import { InstructionsProposer } from './instructions/proposer.ts';
import { LivePoller } from './live/live-poller.ts';
import { PingDelivery, StorePingHold } from './live/ping-delivery.ts';
import { GlancePings } from './live/glance-pings.ts';
import { PING_DECISIONS_PER_DAY, PingDecider } from './live/ping-decider.ts';
import { RaisedPings } from './live/raised-pings.ts';
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
import { loadSyncProgress } from './sync-progress-record.ts';
import { SetupChecks, systemCommands, type CommandRunner } from './setup/setup-checks.ts';
import { SetupFlow } from './setup/setup-flow.ts';
import { SetupSweep } from './setup/setup-sweep.ts';
import { SyncRun, type DigestStoredOptions } from './sync-run.ts';
import { TeamMembers } from './team-members.ts';
import { readPrOverlaps } from './pr-overlaps.ts';
import { saveViewerFollowingRoles } from './team-role-events.ts';
import { TeamRoleKeeper } from './team-roles.ts';
import { ToolHealth } from './tools/tool-health.ts';
import { claudeDirFromEnv } from './work-context/collector.ts';
import { WorkContextSchedule } from './work-context/schedule.ts';
import { storageJobs } from './storage-jobs/jobs.ts';
import { StorageJobRunner } from './storage-jobs/runner.ts';
import { WorkContextSweeper } from './work-context/sweeper.ts';
import type { UserConfigFile } from './user-config.ts';
import { WorkContextMemory } from './work-context/work-context.ts';
import type { GitHubWrites } from './writes/github-writes.ts';
import type { PendingWrites } from './writes/pending-writes.ts';
import { QuietReads } from './writes/quiet-reads.ts';
import { ClickedReadRetry } from './writes/clicked-read-retry.ts';

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
  /**
   * The store was opened read-only (createEngine without the lock, as the
   * MCP process does). Reads then never record anything, not even an
   * instructions.md edited while the app was closed. Missing: false.
   */
  storeReadOnly?: boolean;
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
  /**
   * One agent call per topic: the dossier update and the topic's first glance
   * batch together (DESIGN.md "One call per topic"). createEngine passes
   * POSTPILE_TOPIC_DIGEST=1. Missing: off, separate calls.
   */
  topicDigest?: boolean;
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
  /** `<data folder>/agent-requests`, where MCP processes leave requests for the app. Missing: agent requests stay off. */
  agentRequestsFolder?: string | null;
  /**
   * Hold a start sync's agent work until the inbox catch-up dialog is
   * answered (DESIGN.md "Inbox cleanup"). Only for an app with a window:
   * createEngine sets it except for the CLI. Missing: off.
   */
  catchUpGate?: boolean;
  /** Pause between the catch-up's per-thread mark-reads. Missing: CATCH_UP_PACE_MS; tests pass 0. */
  catchUpPaceMs?: number;
}

/**
 * proposal_resolved tracks a topic merge, a rename or a split (DESIGN.md
 * "Agent trust"; splits since outside agents can suggest them); new_topic
 * has no slot in that event's kind enum, so it is left untracked rather
 * than mapped to something misleading.
 */
function topicProposalTelemetryKind(kind: TopicProposalKind | undefined): 'topic_merge' | 'rename' | 'topic_split' | null {
  if (kind === 'merge' || kind === 'area_merge') {
    return 'topic_merge';
  }
  if (kind === 'split') {
    return 'topic_split';
  }
  return kind === 'rename' ? 'rename' : null;
}

/** EngineService over the store, GitHub and the agent. Each concern lives in its own small class. */
export class Engine implements EngineService {
  private readonly reads: ReadModels;
  private readonly tiles: TileActions;
  private readonly openedReads: OpenedReads;
  private readonly prActions: PrActions;
  private readonly feedback: FeedbackActions;
  private readonly chats: ChatActions;
  private readonly proposals: ProposalActions;
  private readonly memoryActions: MemoryActions;
  private readonly memorySources: MemorySourcesReads;
  private readonly rechecker: MemoryRechecker;
  private readonly instructions: InstructionsActions;
  private readonly lessons: LessonActions;
  private readonly syncRun: SyncRun;
  private readonly consolidationRun: ConsolidationRun;
  private readonly pollRun: PollRun;
  private readonly sweeper: WorkContextSweeper;
  private readonly workContext: WorkContextMemory;
  private readonly sweepSchedule: WorkContextSchedule;
  private readonly storageJobs: StorageJobRunner;
  private readonly cleanup: InboxCleanup;
  private readonly setup: SetupFlow;
  private readonly toolHealth: ToolHealth;
  private readonly mcp: McpConnection;
  private syncing: Promise<SyncReport> | null = null;
  private consolidating: Promise<ConsolidationReport> | null = null;
  private polling: Promise<PollCycle> | null = null;
  /** The refreshes after a write still running; an approve answers before its refresh ends (see PrActions.approve). */
  private writeRefresh: Promise<void> = Promise.resolve();
  /** Refreshes after a write that ended. Counted into the live status' changeCount, so the renderer refetches what they brought in. */
  private writeRefreshesDone = 0;
  /** Full syncs that ended; counted into the live status' changeCount so a short sync between two looks is not missed. */
  private syncsDone = 0;
  private syncCompletedListener: (() => void) | null = null;
  private livePoller: LivePoller | null = null;
  private autoSync: AutoSyncSchedule | null = null;
  private readonly catchUpCap: CatchUpCap;
  private readonly catchUps: CatchUpQueue;
  private readonly quietCatchUps: QuietCatchUps;
  private readonly topicCatchUp: TopicCatchUp;
  /** Stale glances looked at while a full sync or consolidation ran; asked again when it ends. */
  private readonly deferredLooks = new Set<PrKey>();
  private readonly github: GitHubSync;
  private readonly quietReads: QuietReads;
  private readonly telemetry: Telemetry;
  private readonly pingSummary: PingSummary;
  private readonly shedReport: ShedReport;
  private readonly pingDelivery: PingDelivery;
  /** The live poll's onNotify, while it runs. */
  private notifyMac: ((notifications: MacNotification[]) => boolean) | null = null;
  private interruptionsListener: ((mode: InterruptionsMode) => void) | null = null;
  private readonly quota: GitHubQuota;
  /** What the next poll cycle also looks at, set by refreshOnFocus. */
  private focus: PollFocus = NO_FOCUS;
  private readonly agentRefresher: AgentRefresher;
  /** Threads a clicked mark-read's retry holds: the inbox leaves their rows alone meanwhile. */
  private readonly heldThreads = new Set<string>();
  private readonly clickedReadRetry: ClickedReadRetry;
  private readonly outsideProposals: OutsideProposals;
  private readonly prNotes: PrNotes;
  private readonly teamMembers: TeamMembers;
  private readonly teamRoles: TeamRoleKeeper;
  /** The last queued team role flip; `setTeamRole` chains on it. */
  private teamRoleFlips: Promise<unknown> = Promise.resolve();
  private agentRequests: AgentRequestInbox | null = null;

  constructor(private readonly deps: EngineDeps) {
    const { store, now } = deps;
    // So an MCP server started before an app update can tell it runs old code.
    if (deps.storeReadOnly !== true && deps.appVersion && deps.appVersion !== 'unknown') {
      saveAppVersion(store, deps.appVersion);
    }
    this.telemetry = deps.telemetry ?? new NoopTelemetry();
    this.pingSummary = new PingSummary(store, this.telemetry, now);
    this.shedReport = new ShedReport(
      store,
      this.telemetry,
      now,
      { selection: () => Board.lastSelection(store), takeShed: () => this.github.takeShed() },
      deps.syncLog ?? ((line) => console.log(line)),
    );
    this.toolHealth = deps.tools ?? ToolHealth.assumeOk(now);
    const timers = deps.timers ?? systemTimers;
    this.quota = deps.quota ?? new GitHubQuota(() => timers.now());
    const agentOff = (): string | null => this.toolHealth.agentOffReason();
    const history = new InstructionsHistory(store, deps.instructionsFile, now, deps.storeReadOnly === true);
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
    this.storageJobs = new StorageJobRunner({
      store,
      jobs: storageJobs(),
      now,
      timers: deps.timers ?? systemTimers,
      busy: () => this.syncing !== null || this.polling !== null || this.consolidating !== null || this.catchUps.isRunning(),
      log: deps.syncLog ?? ((line) => console.log(line)),
      onDone: (report) =>
        this.telemetry.capture('storage_job_done', {
          name: report.name,
          units: report.units,
          work_ms: report.workMs,
          longest_slice_ms: report.longestSliceMs,
          wall_ms: report.wallMs,
        }),
      onBlocked: (blocked) => this.telemetry.capture('storage_job_blocked', { name: blocked.name, blocked_units: blocked.blockedUnits ?? 0 }),
    });
    const contexts = new PromptContextSource(store, history, () => this.workContext.promptText());
    this.reads = new ReadModels(store, deps.agent, contexts, now, deps.pendingWrites, {
      agentOff: () => agentOff() !== null,
      catchUp: (topicId, prKey) => this.catchUps.stateOf(topicId, prKey),
      catchUpCap: () => ({ off: this.catchUpCap.perDay === 0, spent: this.catchUpCap.remaining() === 0 }),
    });
    const log = deps.writes.log;
    const readMarker = new ReadMarker(store, deps.markReadQueue, log, now);
    this.tiles = new TileActions(store, readMarker, now);
    this.openedReads = new OpenedReads(store, readMarker, deps.writes, now, deps.syncLog ?? ((line) => console.log(line)));
    this.prActions = new PrActions(store, deps.writes, deps.agent, contexts, readMarker, now, (key) => this.refreshAfterWrite(key));
    this.feedback = new FeedbackActions(store, readMarker, now);
    this.chats = new ChatActions(store, deps.agent, contexts, now);
    this.proposals = new ProposalActions(store, now);
    this.memoryActions = new MemoryActions(store, now);
    this.memorySources = new MemorySourcesReads(store, now);
    this.rechecker = new MemoryRechecker(store, deps.agent, contexts, this.memorySources, now);
    this.instructions = new InstructionsActions(store, history, proposer, now);
    this.lessons = new LessonActions(store, deps.agent, contexts, this.chats, now, agentOff);
    const decider = new PingDecider({
      store,
      agent: deps.agent,
      contexts,
      now,
      capPerDay: deps.pingDecisionsPerDay ?? PING_DECISIONS_PER_DAY,
      agentOff,
    });
    const runDeps = {
      store,
      agent: deps.agent,
      contexts,
      callLog: deps.callLog,
      facts: new FactWriter(store, now),
      now,
      agentOff,
      telemetry: this.telemetry,
      glancePings: new GlancePings(store, now),
      raisedPings: new RaisedPings(decider),
      pingDecider: decider,
      topicDigest: deps.topicDigest ?? false,
    };
    const github = new GitHubSync(
      store,
      deps.reader,
      now,
      log,
      deps.pendingWrites,
      this.quota,
      deps.syncLog ?? ((line) => console.log(line)),
      this.heldThreads,
      () => deps.markReadQueue.threadIds(),
    );
    this.github = github;
    this.clickedReadRetry = new ClickedReadRetry(store, deps.reader, deps.writes, (key) => this.refreshForRetry(key), this.heldThreads);
    deps.markReadQueue.retryWith(this.clickedReadRetry);
    deps.markReadQueue.checkMutesWith((key) => muteHoldsNow(store, key, now().toISOString()));
    this.quietReads = new QuietReads(store, deps.reader, deps.writes, now, deps.syncLog ?? ((line) => console.log(line)));
    this.cleanup = new InboxCleanup({
      store,
      writes: deps.writes,
      pendingWrites: deps.pendingWrites,
      now,
      asksOnStart: deps.catchUpGate ?? false,
      pendingGlances: () => {
        const viewer = loadViewer(store);
        return viewer === null ? new Set() : pendingGlanceKeys(store, Board.load(store, now().toISOString()), viewer, runDeps.contexts, deps.agent);
      },
      glances: (keys) => this.reads.glancesNow(keys),
      syncRunning: () => this.syncRun.progress() !== null,
      pause: () => {
        const paceMs = deps.catchUpPaceMs ?? CATCH_UP_PACE_MS;
        return paceMs === 0 ? Promise.resolve() : new Promise((resolve) => timers.setTimeout(resolve, paceMs));
      },
      unreadOnGitHub: async () => {
        const inbox = await deps.reader.listNotifications({ etag: null, lastModified: null });
        return new Set(inbox.notModified ? [] : inbox.threads.map((thread) => thread.id));
      },
      waitForGitHub: () => {
        const waitMs = deps.catchUpPaceMs === 0 ? 0 : CATCH_UP_CONFIRM_EVERY_MS;
        return waitMs === 0 ? Promise.resolve() : new Promise((resolve) => timers.setTimeout(resolve, waitMs));
      },
      afterRun: () => this.afterCleanupRun(),
      telemetry: this.telemetry,
      log: deps.syncLog ?? ((line) => console.log(line)),
    });
    this.syncRun = new SyncRun(
      runDeps,
      github,
      deps.markReadQueue,
      this.quota,
      this.quietReads,
      this.cleanup,
      deps.syncLog,
      () => this.syncCompletedListener?.(),
      () => deps.writes.enabled(),
    );
    this.consolidationRun = new ConsolidationRun(runDeps);
    const lineLog = deps.syncLog ?? ((line: string) => console.log(line));
    this.catchUpCap = new CatchUpCap(deps.catchUpCallsPerDay ?? 0, now);
    const topicCatchUp = new TopicCatchUp(runDeps, this.catchUpCap, lineLog);
    this.topicCatchUp = topicCatchUp;
    // Never beside a full sync or a consolidation: the request is skipped and the sync covers the topic.
    this.catchUps = new CatchUpQueue(
      { topic: (topicId) => topicCatchUp.run(topicId), glances: (topicId, prKeys) => topicCatchUp.runGlances(topicId, prKeys) },
      () => !this.syncing && !this.consolidating && agentOff() === null,
      lineLog,
    );
    this.quietCatchUps = new QuietCatchUps(now);
    this.pollRun = new PollRun(runDeps, github, decider, this.quietReads, (topics) => this.requestCatchUps(topics), () => deps.writes.enabled());
    this.pingDelivery = new PingDelivery({
      hold: new StorePingHold(store),
      unreadPrKeys: () => this.reads.unreadPrKeys(),
      onNotify: (notifications) => this.notifyMac?.(notifications) ?? false,
    });
    this.teamMembers = new TeamMembers(store, deps.reader, now);
    this.teamRoles = new TeamRoleKeeper(store, deps.reader, now, this.quota, deps.syncLog ?? ((line) => console.log(line)));
    const setupSweep = new SetupSweep({
      store,
      reader: deps.reader,
      agent: deps.agent,
      teamMembers: this.teamMembers,
      teamRoles: this.teamRoles,
      history,
      digest: () => this.workContextDigest(),
      now,
    });
    const commands = deps.setupCommands ?? systemCommands(tmpdir());
    const setupChecks = new SetupChecks(deps.reader, commands);
    this.setup = new SetupFlow(store, deps.agent, history, setupChecks, setupSweep, now);
    this.mcp = new McpConnection({ store, commands, tools: this.toolHealth, launcher: deps.mcpLauncher ?? null, now, telemetry: this.telemetry });
    this.outsideProposals = new OutsideProposals(store, now);
    const coverReader = new NoteCoverReader({
      now,
      quota: this.quota,
      pausedReason: () => (this.setup.status().needed ? 'setup not finished' : this.toolHealth.ghOffReason()),
      read: (cover, notedKey) => github.pullInCover(parsePrKey(cover), notedKey),
    });
    this.prNotes = new PrNotes(store, now, coverReader);
    this.agentRefresher = new AgentRefresher({
      now,
      quota: this.quota,
      pr: (key) => {
        const pr = store.prs.get(key);
        return pr ? { fetchedAt: store.prs.fetchedAt(key), updatedAt: pr.updatedAt, state: pr.state } : null;
      },
      topic: async (topicId) => this.reads.getTopic(topicId),
      eventCounts: (keys) => new Map([...store.events.listForPrs(keys)].map(([key, events]) => [key, events.length])),
      read: (keys) => this.readForAgent(keys),
      log: (outcome, detail) => log.record({ action: 'agent_refresh', origin: 'agent', outcome, detail }),
    });
  }

  /** The next poll cycle's focus still holds one of these PRs: the cycle that ran was not ours. */
  private focusHolds(keys: PrKey[]): boolean {
    return this.focus.prRefs.some((ref) => keys.includes(`${ref.repo}#${ref.number}`));
  }

  /**
   * An outside agent's refresh: these PRs fetched directly in one poll
   * cycle, so new events get the usual ping handling and catch-up. A
   * running full sync is joined instead (its freshness check covers every
   * tracked PR). A cycle already running started before the request, so it
   * is waited for, then one runs with these PRs in focus.
   */
  private async readForAgent(keys: PrKey[]): Promise<RefreshRun> {
    const retryAt = new Date(this.deps.now().getTime() + 60_000).toISOString();
    if (this.consolidating) {
      return { kind: 'blocked', reason: 'A consolidation run is going; try again in a minute.', retryAt };
    }
    if (!this.syncing) {
      await this.polling?.catch(() => {});
      this.focus = { threadIds: this.focus.threadIds, prRefs: [...this.focus.prRefs, ...keys.map(parsePrKey)] };
    }
    try {
      let cycle = await this.pollOnce();
      if (cycle.kind === 'done' && this.focusHolds(keys)) {
        cycle = await this.pollOnce();
      }
      if (this.syncing) {
        await this.syncing.catch(() => {});
        return { kind: 'joined_sync' };
      }
      return cycle.kind === 'blocked' ? { kind: 'blocked', reason: `PostPile's GitHub reads are paused: ${cycle.reason}.`, retryAt: null } : { kind: 'ran' };
    } catch (error) {
      return { kind: 'blocked', reason: `The GitHub read failed: ${errorText(error)}.`, retryAt };
    }
  }

  /** The newest work context digest as the setup sweep reads it: prompt text, version and date. */
  private workContextDigest(): { version: number; createdAt: string; text: string } | null {
    const latest = this.deps.store.workContext.latest();
    const text = this.workContext.promptText();
    return latest && text !== '' ? { version: latest.version, createdAt: latest.createdAt, text } : null;
  }

  /**
   * Right after an approve, comment or team removal reached GitHub: one poll
   * cycle that also fetches that PR, so GitHub's new review state shows
   * without a sync. It runs as a normal cycle (serialized with sync and
   * consolidation, new events get ping handling). A cycle already running
   * started before the write, so it is waited for first. A failure is
   * logged; the write itself went through. An approve answers without
   * waiting for it (a poll cycle takes seconds); the renderer hears about
   * the result through the live status (`changeCount`).
   */
  private refreshAfterWrite(key: PrKey): Promise<void> {
    const run = this.pollAfterWrite(key).finally(() => {
      this.writeRefreshesDone += 1;
    });
    this.writeRefresh = Promise.all([this.writeRefresh, run]).then(() => {});
    return run;
  }

  private async pollAfterWrite(key: PrKey): Promise<void> {
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

  /**
   * A clicked mark-read GitHub skipped for newer activity: the PR fetched
   * again before the click is decided again (ClickedReadRetry). The same
   * refresh as after a write; a running full sync is waited for first, then
   * the PR is still fetched, since the sync may have left it alone (the held
   * thread keeps its old updated_at). Nothing while the GitHub quota is
   * nearly used: the snapshot then stays stale and the click stays unread.
   */
  private async refreshForRetry(key: PrKey): Promise<void> {
    if (this.quota.state().level === 'critical') {
      return;
    }
    await this.syncing?.catch(() => {});
    await this.refreshAfterWrite(key);
  }

  /** One catch-up run for each topic, coalesced by the queue; the quiet wait counts from here. Returns the topics the queue skipped. */
  private startCatchUps(topicIds: (string | null)[]): (string | null)[] {
    const skipped: (string | null)[] = [];
    for (const topicId of topicIds) {
      if (this.catchUps.request(topicId) === 'skipped') {
        skipped.push(topicId);
      } else {
        this.quietCatchUps.noteRun(topicId);
      }
    }
    return skipped;
  }

  /**
   * Quiet topics whose wait ended. One the queue skips (the agent is off) goes
   * back on the list: its events are stored, so no later poll reports them again.
   */
  private startDueQuietCatchUps(): void {
    this.quietCatchUps.add(this.startCatchUps(this.quietCatchUps.due()));
  }

  /**
   * Topics the poll brought news for: loud ones run now, quiet ones once their wait is over. A loud one the
   * queue skips (the agent is off) waits with the quiet ones: its events are stored, so no later poll reports
   * them again. Off with a cap of 0.
   */
  private requestCatchUps(topics: CatchUpTopics): void {
    if (this.catchUpCap.perDay === 0) {
      return;
    }
    this.quietCatchUps.add(this.startCatchUps(topics.now));
    this.quietCatchUps.add(topics.quiet);
    this.startDueQuietCatchUps();
  }

  /** Every poll cycle, news or not. Not while a sync or consolidation runs: the list waits for the next cycle. */
  private startDueQuietCatchUpsAfterPoll(): void {
    if (this.catchUpCap.perDay === 0 || this.syncing || this.consolidating) {
      return;
    }
    // Catch-ups that waited for a free slot or for the agent to come back go first.
    this.catchUps.resume();
    this.startDueQuietCatchUps();
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

  /** The hourly pings_summarized event, when one is due. Never throws: telemetry never breaks a sync or a poll. */
  /** The hourly telemetry after a sync or a poll cycle: the ping summary, and what a big inbox made PostPile leave alone. */
  private summarizePings(): void {
    try {
      this.pingSummary.sendIfDue();
      this.shedReport.sendIfDue();
    } catch (error) {
      (this.deps.syncLog ?? console.log)(`ping summary failed: ${errorText(error)}`);
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
   * GitHub writes are on only because this install never chose (DESIGN.md
   * "GitHub writes: lock, action log" › On by default). Once, at the first
   * sync with gh working: the default is stored as the choice, logged and
   * reported, then the mark-reads that waited from the locked days are sent
   * where nothing happened on the thread since the click
   * (`PendingWrites.sendAfterDefault`). Never throws: the sync goes on
   * whatever the send did.
   */
  private async keepWritesDefault(): Promise<void> {
    if (!this.deps.writes.keepDefault()) {
      return;
    }
    const log = this.deps.syncLog ?? console.log;
    this.telemetry.capture('github_writes_changed', { enabled: true, from: 'default' });
    if (!this.deps.pendingWrites.list().some((write) => write.kind === 'mark_read')) {
      log('GitHub writes on by default');
      return;
    }
    try {
      const result = await this.deps.pendingWrites.sendAfterDefault(this.deps.markReadQueue, () => this.writesStatus());
      log(`GitHub writes on by default, pending mark-reads unchanged since the click: ${result.message}`);
    } catch (error) {
      log(`GitHub writes on by default, pending mark-reads not sent: ${errorText(error)}`);
    }
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
    await this.keepWritesDefault();
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
      // Waiting quiet news stays: the sync may never digest, and a run after one that did makes no call.
      this.catchUps.dropQueued();
      const before = Engine.settled([this.consolidating, this.polling, this.catchUps.settled()]);
      // PRs left over by the PR cap bring the next background sync forward, until the board is full:
      // what a full board would cut is not worth a sync every 2 minutes.
      let backlog = false;
      this.syncing = before
        .then(() => this.syncIfGhWorks(options))
        .then((report) => {
          const selection = Board.lastSelection(this.deps.store);
          backlog = report.prsSkipped > 0 && !(selection !== null && isBoardFull(selection));
          return report;
        })
        .finally(() => {
          this.syncing = null;
          this.syncsDone += 1;
          this.summarizePings();
          this.autoSync?.reschedule(backlog);
          this.askDeferredLooks();
          // The poll was blocked while the sync ran; catch up on what happened meanwhile.
          void this.livePoller?.runCycle();
        });
    }
    return this.syncing;
  }

  /**
   * Dev only (`pnpm cli simulate-start`, see SyncRun.digestStored): the
   * sync's digest and retire steps on stored data, no GitHub at all. Not
   * part of EngineService; the CLI runs it alone on a scratch database.
   */
  digestStored(options: DigestStoredOptions): Promise<SyncReport> {
    return this.syncRun.digestStored(options);
  }

  consolidate(options: ConsolidateOptions = {}): Promise<ConsolidationReport> {
    if (!this.consolidating) {
      const before = Engine.settled([this.syncing, this.polling, this.catchUps.settled()]);
      this.consolidating = before
        .then(() => this.consolidationRun.run(options))
        .finally(() => {
          this.consolidating = null;
          this.askDeferredLooks();
          // Catch-ups that waited while it ran.
          this.catchUps.resume();
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
    // The start sync waits for the inbox catch-up's answer: no topic calls or catch-ups before it (the answer resumes the sync).
    if (this.syncRun.holding()) {
      return Promise.resolve({ kind: 'blocked', reason: 'waiting for the inbox catch-up answer' });
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
        .then((cycle) => {
          this.summarizePings();
          this.startDueQuietCatchUpsAfterPoll();
          return cycle;
        })
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
    this.notifyMac = options.onNotify;
    this.livePoller = new LivePoller(() => this.pollOnce(), this.deps.timers ?? systemTimers, options, this.pingDelivery, this.quota);
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

  noteSuspend(): void {
    this.autoSync?.suspend();
    this.storageJobs.suspend();
  }

  noteWake(): void {
    this.autoSync?.wake();
    this.storageJobs.resume();
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

  /** Looks that came in during a full sync or consolidation, asked again once it ended (`refreshGlanceOnLook` re-checks everything). */
  private askDeferredLooks(): void {
    const keys = [...this.deferredLooks];
    this.deferredLooks.clear();
    for (const key of keys) {
      void this.refreshGlanceOnLook(key).catch((error: unknown) => (this.deps.syncLog ?? console.log)(`catch-up glance ${key}: ${errorText(error)}`));
    }
  }

  async refreshGlanceOnLook(prKey: PrKey): Promise<GlanceLookResult> {
    const { store, now } = this.deps;
    if (this.toolHealth.agentOffReason() !== null || this.catchUpCap.perDay === 0 || this.catchUpCap.remaining() === 0) {
      return { outcome: 'blocked' };
    }
    if (!store.prs.get(prKey)) {
      return { outcome: 'skipped' };
    }
    if (this.syncing || this.consolidating) {
      // The renderer asks once per open: keep the look and ask again when the run ends (the sync may have written it by then).
      this.deferredLooks.add(prKey);
      return { outcome: 'deferred' };
    }
    if (!this.topicCatchUp.needsGlance(prKey, true)) {
      return { outcome: 'current' };
    }
    const topicId = Board.load(store, now().toISOString()).memberships.get(prKey)?.topicId ?? null;
    const request = this.catchUps.requestGlance(topicId, prKey);
    (this.deps.syncLog ?? console.log)(`catch-up ${topicId ?? 'unsorted'} glance ${prKey}: looked at, ${request}`);
    return { outcome: request };
  }

  async refreshOnFocus(prKeys: PrKey[]): Promise<void> {
    if (this.syncing || this.consolidating) {
      return;
    }
    if (prKeys.length > 0) {
      const threads = this.deps.store.notifications.getByPrKeys(prKeys);
      this.focus = {
        threadIds: [...threads.values()].map((thread) => thread.id),
        prRefs: prKeys.filter((key) => !threads.has(key)).map(parsePrKey),
      };
    }
    // A cycle already running is joined, and a debounced focus runs none; the
    // opened PRs then ride on the next cycle.
    if (this.livePoller) {
      await this.livePoller.runOnFocus();
    } else if (prKeys.length > 0) {
      await this.pollOnce().catch(() => {});
    }
  }

  refreshNow(target: AgentRefreshTarget, options: AgentRefreshOptions): Promise<AgentRefreshResult> {
    return this.agentRefresher.refresh(target, options.client);
  }

  async proposeTopicChange(change: TopicChangeRequest, options: { client: string }): Promise<TopicChangeResult> {
    return this.outsideProposals.propose(change, options.client);
  }

  async notePr(request: PrNoteRequest, options: { client: string }): Promise<PrNoteResult> {
    return this.prNotes.handle(request, options.client);
  }

  async clearPrNote(noteId: string): Promise<PrNoteResult> {
    return this.prNotes.clear(noteId, 'user');
  }

  async listPrNotes(prKeys: PrKey[]): Promise<PrNotesView[]> {
    return this.reads.listPrNotes(prKeys);
  }

  startAgentRequests(): void {
    const folder = this.deps.agentRequestsFolder;
    if (this.agentRequests || !folder) {
      return;
    }
    this.agentRequests = new AgentRequestInbox({
      folder,
      handle: (request) => answerAgentRequest(this, request),
      now: this.deps.now,
      log: this.deps.syncLog ?? ((line) => console.log(line)),
    });
    this.agentRequests.start();
  }

  stopAgentRequests(): void {
    this.agentRequests?.stop();
  }

  /** The poll's own status, plus what the renderer refreshes on (syncs, the next auto sync, catch-up runs) and the GitHub quota while it is low. */
  async livePollStatus(): Promise<LivePollStatus> {
    const poll = this.livePoller?.currentStatus() ?? OFF_POLL_STATUS;
    return {
      ...poll,
      changeCount: poll.changeCount + this.writeRefreshesDone + this.deps.markReadQueue.mirrored() + this.syncsDone + this.clickedReadRetry.decided() + this.cleanup.changeCount() + this.prNotes.changes(),
      syncRunning: this.syncing !== null,
      nextAutoSyncAt: this.autoSync?.nextSyncAt() ?? null,
      catchUpChanges: this.catchUps.changes(),
      githubQuota: this.quota.view(poll.everySeconds),
      keptUnread: this.clickedReadRetry.notice(),
    };
  }

  async syncProgress(): Promise<SyncProgress | null> {
    return this.syncRun.progress();
  }

  async recordedSyncProgress(): Promise<RecordedSyncProgress | null> {
    return loadSyncProgress(this.deps.store);
  }

  async lastSyncReport(): Promise<SyncReport | null> {
    return loadLastSyncReport(this.deps.store);
  }

  async recordedAppVersion(): Promise<string | null> {
    return loadAppVersion(this.deps.store);
  }

  async databaseSchemaVersion(): Promise<number | null> {
    return recordedVersion(this.deps.store.db);
  }

  async listTopics(scope?: ListScope): Promise<TopicListItem[]> {
    return this.reads.listTopics(scope);
  }

  onSyncCompleted(listener: () => void): void {
    this.syncCompletedListener = listener;
  }

  async boardShape(): Promise<BoardShapeEvent[]> {
    return this.reads.boardShape();
  }

  async unreadPrKeys(): Promise<PrKey[]> {
    return this.reads.unreadPrKeys();
  }

  async pingClickTarget(notification: Pick<MacNotification, 'target' | 'prKeys'>): Promise<PingTarget | null> {
    return this.reads.pingClickTarget(notification);
  }

  async interruptions(): Promise<InterruptionsView> {
    return interruptionsView(this.pingDelivery.mode(), this.pingDelivery.chosen());
  }

  async setInterruptions(mode: InterruptionsMode, from: InterruptionsFrom): Promise<InterruptionsView> {
    this.pingDelivery.setMode(mode);
    this.telemetry.capture('interruptions_changed', { mode, from });
    this.interruptionsListener?.(mode);
    return interruptionsView(mode, true);
  }

  onInterruptionsChange(listener: (mode: InterruptionsMode) => void): void {
    this.interruptionsListener = listener;
  }

  async pingBadge(): Promise<number> {
    return this.reads.tilesHolding(this.pingDelivery.shownPrKeys());
  }

  async pingsVisited(prKeys: PrKey[]): Promise<void> {
    this.pingDelivery.visited(prKeys);
  }

  async listFinishedTopics(): Promise<FinishedTopic[]> {
    return this.reads.listFinishedTopics();
  }

  async busyInbox(): Promise<BusyInboxView> {
    return this.reads.busyInbox();
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

  async getTeamRoles(): Promise<TeamRolesView> {
    return this.teamRoles.view(loadViewer(this.deps.store));
  }

  async prOverlaps(): Promise<PrOverlapsView> {
    return readPrOverlaps(this.deps.store);
  }

  async getTeamMembers(): Promise<TeamMembersView> {
    return this.teamMembers.view(loadViewer(this.deps.store));
  }

  private async applyTeamRole(team: string, role: TeamRole): Promise<TeamRolesView> {
    const { store } = this.deps;
    const viewer = loadViewer(store);
    if (!viewer?.teams.includes(team)) {
      throw new Error(`not one of your teams: ${team}`);
    }
    const roles = this.teamRoles.setRole(team, role);
    saveViewerFollowingRoles(store, await this.teamMembers.attach(withHomeTeams(viewer, roles)), this.deps.now().toISOString());
    return this.teamRoles.view(viewer);
  }

  /**
   * Flips run one at a time: each reads the viewer and roles the previous
   * one saved, so two quick flips cannot overwrite each other with a stale
   * role map while the member fetch is awaited.
   */
  async setTeamRole(team: string, role: TeamRole): Promise<TeamRolesView> {
    const flip = this.teamRoleFlips.then(() => this.applyTeamRole(team, role));
    this.teamRoleFlips = flip.catch(() => undefined);
    return flip;
  }

  async getTopic(topicId: string): Promise<TopicDetail | null> {
    return this.reads.getTopic(topicId);
  }

  async getPr(prKey: PrKey): Promise<PrDetail | null> {
    return this.reads.getPr(prKey);
  }

  async listPrEvents(prKey: PrKey): Promise<EventView[]> {
    return this.reads.listPrEvents(prKey);
  }

  async debugNotifications(limit: number): Promise<NotificationDebugRow[]> {
    return this.reads.debugNotifications(limit);
  }

  async handledQuietly(): Promise<QuietReadView[]> {
    return this.reads.handledQuietly();
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
    if (change.ok) {
      this.telemetry.capture('github_writes_changed', { enabled, from: 'footer' });
    }
    return { ...change, status: this.writesStatus() };
  }

  async sendPendingWrites(): Promise<PendingWritesResult> {
    const hadCleanup = this.deps.pendingWrites.pendingCleanupCutoff() !== null;
    const result = await this.deps.pendingWrites.send(this.deps.markReadQueue, (write) => this.cleanup.startFromPending(write), () => this.writesStatus());
    if (hadCleanup && this.deps.pendingWrites.pendingCleanupCutoff() === null) {
      await this.rereadInbox().catch(() => {});
      return { ...result, status: this.writesStatus() };
    }
    return result;
  }

  async inboxCleanup(): Promise<InboxCleanupView> {
    return this.cleanup.view(this.syncRun.holding());
  }

  /**
   * A sync held for the start dialog goes on: the sync that resumes it
   * fetches again (cheap) and runs the agent work over both fetches. A sync
   * already running is joined instead; it asks the gate again itself.
   */
  private resumeHeldSync(): void {
    const options = this.syncRun.heldOptions();
    if (options !== null) {
      void this.sync(options).catch(() => {});
    }
  }

  /** After a cleanup run ended: a held sync resumes (it reads the inbox too), else one poll cycle shows the bulk calls. */
  private afterCleanupRun(): void {
    if (this.syncRun.holding()) {
      this.resumeHeldSync();
      return;
    }
    void this.rereadInbox().catch(() => {});
  }

  async clearInbox(request: CleanupRequest): Promise<ActionResult> {
    const result = this.cleanup.clear(request);
    // A refused clear leaves the start dialog open and unanswered: the held sync keeps waiting.
    if (result.ok) {
      this.resumeUnlessRunning();
    }
    return result;
  }

  async clearSafeMerged(request: SafeCleanupRequest): Promise<ActionResult> {
    return this.cleanup.clearSafe(request);
  }

  async startAsUsual(): Promise<ActionResult> {
    const result = this.cleanup.startAsUsual();
    this.resumeUnlessRunning();
    return result;
  }

  /** Locked, nothing to clear or refused: no run to wait for, so a held sync goes on now. */
  private resumeUnlessRunning(): void {
    if (!this.cleanup.isRunning()) {
      this.resumeHeldSync();
    }
  }

  /** For tests: settles when the inbox cleanup's background run did. */
  inboxCleanupSettled(): Promise<void> {
    return this.cleanup.settled();
  }

  async discardPendingWrites(): Promise<PendingWritesResult> {
    return this.deps.pendingWrites.discard(() => this.writesStatus());
  }

  async approve(prKey: PrKey, headOid: string, body = '', noteSource?: ReviewNoteSource): Promise<ActionResult> {
    const result = await this.prActions.approve(prKey, headOid, body);
    if (result.ok) {
      // The single approve runs from the detail pane's review row (CLAUDE.md
      // "Approve is final"); the agent-backed ones go through approveMany.
      const withNote = body.trim() !== '';
      const note = withNote ? noteSource : 'none';
      this.telemetry.capture('pr_approved', { from: 'detail', was_agent_approved: false, with_note: withNote, ...(note ? { note } : {}) });
    }
    return result;
  }

  async approveMany(prs: ApprovePrRequest[], from: AgentActionFrom): Promise<BatchApproveResult> {
    if (prs.length === 0) {
      return { ok: false, message: 'No PRs to approve', undoToken: null, results: [] };
    }
    // Approve is final: every PR is checked against the current board first, with the same core rules as the offer,
    // and a stack layer only goes through after the covered layers below it did (base up).
    const keys = new Set(prs.map((pr) => pr.prKey));
    const views = this.reads.currentTileViews((tile) => tile.members.some((member) => keys.has(member.prKey)));
    const results: PrApproveResult[] = [];
    let settleToken: string | undefined;
    for (const { prKey, headOid } of prs) {
      const holding = views.filter((view) => view.tile.members.some((member) => member.prKey === prKey));
      const refusal = agentApproveRefusal(prKey, holding, from) ?? agentApproveSkip(prKey, holding, from, results);
      if (refusal !== null) {
        results.push({ prKey, ok: false, message: refusal });
        continue;
      }
      const result = await this.prActions.approve(prKey, headOid);
      results.push({ prKey, ok: result.ok, message: result.message });
      if (result.ok) {
        this.telemetry.capture('pr_approved', { from, was_agent_approved: true, with_note: false, note: 'none' });
        settleToken = result.settleToken ?? settleToken;
      }
    }
    const summary = approvalsSummary(results);
    return { ...summary, undoToken: null, results, ...(settleToken ? { settleToken } : {}) };
  }

  async removeTeamRequest(prKey: PrKey, team: string): Promise<ActionResult> {
    const result = await this.prActions.removeTeamRequest(prKey, team);
    if (result.ok) {
      this.telemetry.capture('team_request_removed', {});
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

  async markPrRead(tileId: string, prKey: PrKey): Promise<ActionResult> {
    const result = await this.tiles.markPrRead(tileId, prKey);
    if (result.ok) {
      this.telemetry.capture('marked_read', { count: 1, origin: 'detail' });
    }
    return result;
  }

  async markTilesRead(tileIds: string[], from: AgentActionFrom): Promise<ActionResult> {
    // Checked against the current board like the offer: tiles no longer backed are skipped and named.
    const ids = new Set(tileIds);
    const views = this.reads.currentTileViews((tile) => ids.has(tile.id));
    const unknown = tileIds.find((tileId) => !views.some((view) => view.tile.id === tileId));
    if (unknown !== undefined) {
      return failed(`no tile ${unknown}`);
    }
    const skipped = views.flatMap((view) => {
      const refusal = agentMarkReadRefusal(view);
      return refusal === null ? [] : [`${view.tile.title}: ${refusal}`];
    });
    const backed = views.filter((view) => agentMarkReadRefusal(view) === null).map((view) => view.tile.id);
    if (backed.length === 0) {
      return failed(`Nothing marked read; skipped ${skipped.join('; ')}`);
    }
    const result = this.tiles.markTilesRead(backed);
    if (result.ok) {
      this.telemetry.capture('marked_read', { count: backed.length, origin: from });
    }
    return skipped.length === 0 ? result : { ...result, message: `${result.message}; skipped ${skipped.join('; ')}` };
  }

  async markThreadRead(threadId: string): Promise<ActionResult> {
    const result = await this.tiles.markThreadRead(threadId);
    if (result.ok) {
      this.telemetry.capture('marked_read', { count: 1, origin: 'debug' });
    }
    return result;
  }

  async markOpenedRead(prKey: PrKey): Promise<OpenedReadResult> {
    return this.openedReads.markOpened(prKey);
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

  async commentReview(prKey: PrKey, headOid: string, body: string, noteSource?: ReviewNoteSource): Promise<ActionResult> {
    const result = await this.prActions.commentReview(prKey, headOid, body);
    if (result.ok) {
      this.telemetry.capture('comment_review_sent', noteSource ? { note: noteSource } : {});
    }
    return result;
  }

  draftAsk(prKey: PrKey, person: string, intent: string): Promise<{ body: string }> {
    return this.prActions.draftAsk(prKey, person, intent);
  }

  draftReviewNote(prKey: PrKey, kind: ReviewNoteKind, gist?: string): Promise<{ body: string }> {
    return this.prActions.draftReviewNote(prKey, kind, gist);
  }

  draftReply(prKey: PrKey, commentId: string, gist: string): Promise<{ body: string }> {
    return this.prActions.draftReply(prKey, commentId, gist);
  }

  async replyToComment(prKey: PrKey, commentId: string, body: string): Promise<ActionResult> {
    const { result, target } = await this.prActions.replyToComment(prKey, commentId, body);
    if (result.ok && target) {
      this.telemetry.capture('reply_sent', { target: target.kind });
    }
    return result;
  }

  async react(prKey: PrKey, commentId: string): Promise<ActionResult> {
    const result = await this.prActions.react(prKey, commentId);
    if (result.ok) {
      this.telemetry.capture('reaction_sent', {});
    }
    return result;
  }

  async sendComment(prKey: PrKey, body: string): Promise<ActionResult> {
    // The only caller is the review row's Ask composer (renderer components/ReviewRow.tsx).
    const result = await this.prActions.sendComment(prKey, body);
    if (result.ok) {
      this.telemetry.capture('ask_sent', {});
    }
    return result;
  }

  async giveFeedback(input: FeedbackInput): Promise<ActionResult> {
    const result = await this.feedback.giveFeedback(input);
    if (result.ok && input.kind === 'wrong_topic') {
      this.telemetry.capture('wrong_topic_marked', input.pickedFrom ? { from: input.pickedFrom } : {});
    } else if (result.ok && input.kind === 'not_related') {
      this.telemetry.capture('not_related_marked', {});
    }
    return result;
  }

  async unmuteEvent(eventId: string): Promise<ActionResult> {
    return this.feedback.unmuteEvent(eventId);
  }

  async getTopicChat(topicId: string): Promise<ChatMessage[]> {
    return this.chats.getTopicChat(topicId);
  }

  async topicChat(topicId: string, message: string): Promise<ChatReply> {
    const reply = await this.chats.topicChat(topicId, message);
    this.telemetry.capture('chat_message_sent', {});
    return reply;
  }

  async decideTailoring(topicId: string, text: string, keep: boolean): Promise<ActionResult> {
    return this.chats.decideTailoring(topicId, text, keep);
  }

  async decideTopicProposal(proposalId: string, accept: boolean): Promise<ActionResult> {
    // Read the kind before deciding: decide() marks the proposal accepted/rejected in place.
    const proposal = this.deps.store.proposals.get(proposalId);
    const kind = topicProposalTelemetryKind(proposal?.kind);
    const result = await this.proposals.decide(proposalId, accept);
    if (result.ok && kind && proposal) {
      this.telemetry.capture('proposal_resolved', { kind, accepted: accept, source: proposal.source });
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

  /**
   * "Archive now": a topic with nothing left moves to the Archive without
   * waiting its 2 quiet days. It comes back like any topic there: a new PR,
   * or a thread turning unread.
   */
  async archiveTopic(topicId: string): Promise<ActionResult> {
    const { store } = this.deps;
    const at = this.deps.now().toISOString();
    if (!topicRetireGate(store, at, topicId).nothingLeft(topicId)) {
      return { ok: false, message: 'Something in this topic is still open or unread', undoToken: null };
    }
    if (!changeTopicStatus(store, topicId, 'retire', at)) {
      return { ok: false, message: 'This topic is not in the sidebar', undoToken: null };
    }
    this.telemetry.capture('topic_archived', {});
    return { ok: true, message: 'Moved to the Archive', undoToken: null };
  }

  async setTopicDriver(topicId: string, driver: string | null): Promise<ActionResult> {
    const { store } = this.deps;
    const result = setTopicDriver(store, topicId, driver, this.deps.now().toISOString());
    if (result.ok) {
      const kind = driver === null ? 'automatic' : driverKind(driver, loadViewer(store));
      // Only teammates are offered by name, so a named person is one.
      this.telemetry.capture('driver_set', { kind: kind === 'person' ? 'teammate' : kind });
    }
    return result;
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

  async proposeInstructionsFromLesson(lessonId: number): Promise<InstructionsProposalReply> {
    const off = this.toolHealth.agentOffReason();
    if (off !== null) {
      return { reply: off, proposal: null };
    }
    return this.instructions.proposeFromLesson(lessonId);
  }

  async getLessons(topicId: string): Promise<LessonView[]> {
    return this.lessons.list(topicId);
  }

  async getLesson(lessonId: number): Promise<LessonView | null> {
    return this.lessons.get(lessonId);
  }

  teachLesson(prKey: PrKey, note: string): Promise<TeachLessonResult> {
    return this.lessons.teach(prKey, note);
  }

  async keepLessonForTopic(lessonId: number): Promise<ActionResult> {
    return this.lessons.keepForTopic(lessonId);
  }

  async dismissLesson(lessonId: number): Promise<ActionResult> {
    return this.lessons.dismiss(lessonId);
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

  startStorageJobs(): void {
    this.storageJobs.start();
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
      if (request.interruptions !== null) {
        await this.setInterruptions(request.interruptions, 'setup');
      }
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

  /** Resolves once every refresh after a write has ended (an approve answers before its refresh does). */
  writeRefreshSettled(): Promise<void> {
    return this.writeRefresh;
  }

  async close(): Promise<void> {
    this.stopAgentRequests();
    // Requests taken already finish and leave their answer before the store closes.
    await this.agentRequests?.settled();
    this.stopLivePoll();
    this.stopAutoSync();
    this.catchUps.dropQueued();
    // A running sweep is not awaited (it can take minutes); its late write fails quietly.
    this.stopWorkContextSchedule();
    // No further storage job slice; the next start goes on after the last one.
    this.storageJobs.stop();
    await this.writeRefresh;
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
