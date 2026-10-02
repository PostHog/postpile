import type {
  ReadCause,
  ReadScope,
  ActionLogEntry,
  ActionResult,
  AgentRefreshOptions,
  AgentRefreshResult,
  AgentRefreshTarget,
  TopicChangeRequest,
  TopicChangeResult,
  ChatMessage,
  ChatReply,
  ConsolidationReport,
  EventView,
  FactQuery,
  FactView,
  Feedback,
  FeedbackInput,
  FeedbackKind,
  FinishedTopic,
  GitHubWritesChange,
  CleanupAge,
  InboxCleanupView,
  PendingWritesResult,
  GitHubWritesStatus,
  GlanceGap,
  InstructionsChatReply,
  InstructionsDecision,
  InstructionsProposalReply,
  InstructionsSaveResult,
  InstructionsView,
  WorkContextSweepResult,
  WorkContextView,
  WorkThreadForget,
  LivePollStatus,
  McpConnectionView,
  SyncPhase,
  SyncProgress,
  MemoryCorrection,
  MemoryCorrectionKind,
  MemoryRecheckOutcome,
  MemoryRecheckRequest,
  MemoryRecheckResult,
  MemorySources,
  MemoryTarget,
  NotificationDebugRow,
  NotificationThread,
  NotificationLanding,
  PendingProposals,
  PrDetail,
  PrEvent,
  PrKey,
  RepoOverview,
  RepoSettings,
  Snooze,
  SnoozeCondition,
  SnoozeWrites,
  SyncReport,
  SetupAcceptRequest,
  SetupAcceptResult,
  SetupChecksView,
  SetupFitRequest,
  SetupFitResult,
  SetupRefineRequest,
  SetupRefineResult,
  SetupStatus,
  SetupSweepView,
  Tile,
  TileRepoLabels,
  TileState,
  TileView,
  PrSummaryInput,
  AgentActionFrom,
  ApprovePrRequest,
  BatchApproveResult,
  PrApproveResult,
  ToolsView,
  Topic,
  TopicArchiveBox,
  TopicDetail,
  TopicListItem,
  TopicQueues,
  UserPrState,
  TeamRole,
  TeamRolesView,
  ViewerView,
  BoardShapeEvent,
} from '@postpile/core';
import {
  activityList,
  whatsNew,
  agentOnlyApprovers,
  standingApprovals,
  UNDO_WINDOW_MS,
  viewerApproval,
  agentPrFacts,
  agentApproveRefusal,
  agentApproveSkip,
  agentMarkReadRefusal,
  approvalsSummary,
  tilesReadScope,
  buildPrSummary,
  buildTileView,
  topicAgentOffers,
  planRead,
  prReadScope,
  deriveTileState,
  takesNewPrs,
  archiveEndsAt,
  snoozeWrites,
  eventView,
  compareTopicUrgency,
  actionTrail,
  cleanupCutoff,
  cleanupLook,
  CLEANUP_SNOOZE_DAYS,
  DEFAULT_REPO_SETTINGS,
  unreadOlderThan,
  isPrInQuietRepo,
  isQuietTile,
  isTopicInScope,
  scopedSettings,
  type ListScope,
  isTracked,
  glanceRefreshBlockOf,
  glanceStateOf,
  type GlanceLookResult,
  type GlanceRefreshBlock,
  type GlanceState,
  labelBaseRepo,
  tileRepoLabels,
  viewerOrgs,
  normalizeRepoScope,
  repoOverview,
  withQuietRepo,
  debugEventLines,
  emptyAgentCallStats,
  fixedClaimNote,
  topicMove,
  OFF_POLL_STATUS,
  systemTimers,
  ownerRelation,
  pingedPrKeys,
  prTier,
  prStatus,
  prWhoseTurn,
  isReReviewMove,
  searchTopics,
  setIdFromTileId,
  threadPrKey,
  topicFaces,
  topicPeople,
  openInDealtWith,
  topicPrRollup,
  topicSection,
  topicQueues,
  topicUrgency,
  topicYourMoves,
  yourMovesByGroup,
  type AgentCallStats,
  type Pr,
  type PrTier,
  type TileMember,
  type SearchableTopic,
  type SearchResult,
  type Viewer,
  type OpenedReadInput,
  actorsFromQuietDetail,
  openedReadCheck,
  prAfterMarkRead,
  ownTeamRequests,
  teamSlug,
  quietReasonFromDetail,
  HANDLED_QUIETLY_DAYS,
  parsePrKey,
  pingDecisionsByThread,
  pingClickTarget,
  type MacNotification,
  type PingDecision,
  type PingTarget,
  type OpenedReadResult,
  type QuietReadView,
} from '@postpile/core';
import { AgentRefresher, AutoSyncSchedule, LivePoller, NEW_COMMITS_SINCE_LOOKED, type AutoSyncOptions, type EngineService, type GitHubQuota, type LivePollOptions, type PollCycle } from '@postpile/engine';
import { FakeCatchUp } from './fake-catch-up.ts';
import { FakeInstructions } from './fake-instructions.ts';
import { FakeSetup } from './fake-setup.ts';
import { FakeTeamRoles } from './fake-team-roles.ts';
import { FakeMcp } from './fake-mcp.ts';
import { FakeTopicChanges } from './fake-topic-changes.ts';
import { fakeQuota, type FakeQuotaLevel } from './fake-quota.ts';
import { FakeTools, type FakeToolProblem } from './fake-tools.ts';
import { FakeWorkContext } from './fake-work-context.ts';
import { FakeLivePoll } from './fake-live.ts';
import { FakeMemory } from './fake-memory.ts';
import { sampleThreads } from './fake-notifications.ts';
import { samplePingDecisions, sampleQuietReads } from './fake-quiet.ts';
import { FakeWrites, type FakeLocalChange } from './fake-writes.ts';
import { buildSampleData, type SampleData } from './sample-data.ts';

interface MarkReadBatch {
  token: string;
  batchId: string;
  eventIds: string[];
  handledPrKeys: PrKey[];
  queuedAt: number;
}

export interface FakeEngineOptions {
  now?: () => Date;
  /** How long a canned recheck "thinks". Tests pass 0. */
  recheckDelayMs?: number;
  /** How long each step of a fake sync takes, so the title bar progress moves. Tests pass 0. */
  syncStepMs?: number;
  /** How long a work context Refresh "thinks". Tests pass 0. */
  sweepDelayMs?: number;
  /** POSTPILE_FAKE_SETUP=1: no instructions yet, and the setup flow shows until accepted or skipped. */
  forceSetup?: boolean;
  /** Base delay of the canned setup checks, sweep lines and refine. Tests pass 0. */
  setupStepMs?: number;
  /** POSTPILE_FAKE_MISSING: gh or claude problems to simulate (see FakeTools). */
  missingTools?: FakeToolProblem[];
  /** How long each step of the sample glance catch-up (queued, then writing) takes. Tests pass 0. */
  catchUpStepMs?: number;
  /** POSTPILE_FAKE_QUOTA: a GitHub quota that is low or nearly used (see fake-quota.ts). */
  quota?: FakeQuotaLevel | null;
  /** POSTPILE_FAKE_TIDY=1: the first sync runs the one-time topic tidy, so the overlay shows. */
  tidyOnFirstSync?: boolean;
}

/** One step of the fake sync: what runs, calls it plans, calls that come back by its end. */
interface FakeSyncStep {
  running: SyncPhase[];
  plan: number;
  done: number;
}

/**
 * Walks like a real sync (DESIGN.md › Sync flow › Scheduling): the glance is
 * planned only once a dossier landed, so the total grows mid-run. Adds up to
 * the 4 calls in sampleSyncStats.
 */
const FAKE_SYNC_STEPS: FakeSyncStep[] = [
  { running: ['fetch'], plan: 0, done: 0 },
  { running: ['dossiers', 'events'], plan: 3, done: 1 },
  { running: ['dossiers', 'events'], plan: 0, done: 1 },
  { running: ['dossiers', 'glances'], plan: 1, done: 1 },
  { running: ['glances'], plan: 0, done: 1 },
];

const FAKE_FEEDBACK_KINDS: Record<MemoryCorrectionKind, FeedbackKind> = {
  wrong: 'memory_wrong',
  forget: 'memory_forget',
  confirm: 'memory_confirmed',
  fix: 'memory_fixed',
};

const FAKE_LINE_MESSAGES: Record<MemoryCorrectionKind, string> = {
  wrong: 'Noted. The next sync rewrites the topic memory without it.',
  forget: 'Noted. The next sync rewrites the topic memory without it.',
  confirm: 'Kept. The next sync keeps that line.',
  fix: 'Fixed. The next sync writes the corrected line into the topic memory.',
};

/** Sample glances that read as older than the PR (its last push came after), for the stale verdict box. */
const STALE_SAMPLE_GLANCES = new Set<PrKey>(['acme/app#1904']);

const RECHECK_CYCLE: MemoryRecheckOutcome[] = ['holds', 'fix', 'drop'];

/** How long before start the sample PRs count as fetched. */
const SAMPLE_FETCH_AGE_MS = 4 * 60_000;

const NOT_OPENED: OpenedReadResult = { marked: false, undoToken: null, undoUntil: null };

function ok(message: string, undoToken: string | null = null): ActionResult {
  return { ok: true, message, undoToken };
}

function fail(message: string): ActionResult {
  return { ok: false, message, undoToken: null };
}

/** Stand-in for the agent spotting a lasting point in chat. Where it applies is the user's pick. */
const LASTING = /\b(always|never|from now on|in general|every topic|all topics)\b/i;

/** Canned numbers so the footer has something to show; the fake never calls the agent. */
function sampleSyncStats(): AgentCallStats {
  const stats = emptyAgentCallStats();
  const count = (calls: number, durationMs: number, costUsd: number) => ({
    calls, failed: 0, retries: 0, skippedUnchanged: 0, skippedByBudget: 0, durationMs, costUsd,
  });
  stats.byKind.dossier_update = count(2, 38000, 0.12);
  stats.byKind.glance_batch = count(1, 9000, 0.01);
  stats.byKind.event_classification = count(1, 6000, 0.01);
  stats.total = 4;
  return stats;
}

/**
 * In-memory EngineService over the Depot sample data. Lets the server, CLI and
 * desktop app run before the real engine exists. Never talks to GitHub or the
 * agent; actions only change the in-memory copy. Tile state, rows and tile
 * views come from the same core rules as the engine.
 */
export class FakeEngine implements EngineService {
  private readonly data: SampleData;
  private readonly memory: FakeMemory;
  private readonly instructions: FakeInstructions;
  private readonly live: FakeLivePoll;
  private readonly workContext: FakeWorkContext;
  private readonly setup: FakeSetup;
  private readonly teamRoles: FakeTeamRoles;
  private readonly toolStatus: FakeTools;
  private readonly mcp: FakeMcp;
  private readonly topicChanges: FakeTopicChanges;
  private readonly agentRefresher: AgentRefresher;
  private readonly checkDelayMs: number;
  private lastSync: SyncReport | null = null;
  private livePoller: LivePoller | null = null;
  private autoSync: AutoSyncSchedule | null = null;
  private readonly catchUp: FakeCatchUp;
  private readonly quota: GitHubQuota;
  private readonly now: () => Date;
  private readonly startedAt: Date;
  /** Snoozes by PR, as in the store. */
  private readonly snoozes = new Map<PrKey, Snooze>();
  private readonly chats = new Map<string, ChatMessage[]>();
  private readonly feedback: Feedback[];
  private readonly batches: MarkReadBatch[] = [];
  private readonly writes: FakeWrites;
  /** Sample decisions plus the fake poll's own, oldest sample first. */
  private readonly pingDecisions: PingDecision[];
  private readonly memoryUndos = new Map<string, { until: number; undo: () => void }>();
  private readonly recheckDelayMs: number;
  private readonly syncStepMs: number;
  private tidyPending: boolean;
  private syncing: Promise<SyncReport> | null = null;
  private progress: SyncProgress | null = null;
  private recheckCount = 0;
  // The repo menu's choices; in memory like the lock, gone on restart.
  private repoSettings: RepoSettings = DEFAULT_REPO_SETTINGS;
  // Inbox cleanup, in memory: every fake start counts as a first run, so the banner shows.
  private cleanupProminent = true;
  private cleanupHiddenUntil: string | null = null;
  // Starts above the ids of the seeded feedback.
  private nextId = 100;
  /** When each sample PR was last "fetched": a few minutes before start, moved by a fake agent refresh. */
  private readonly fetchedAt = new Map<PrKey, string>();


  constructor(options: FakeEngineOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.startedAt = this.now();
    this.recheckDelayMs = options.recheckDelayMs ?? 1500;
    this.syncStepMs = options.syncStepMs ?? 800;
    this.tidyPending = options.tidyOnFirstSync ?? false;
    this.data = buildSampleData(this.now());
    const catchUpStepMs = options.catchUpStepMs ?? 4000;
    this.catchUp = new FakeCatchUp(this.data, this.now, { queuedMs: catchUpStepMs, writingMs: catchUpStepMs * 1.5 });
    this.toolStatus = new FakeTools(options.missingTools ?? [], this.now);
    this.quota = fakeQuota(options.quota ?? null, this.now);
    this.mcp = new FakeMcp(() => this.toolStatus.view().claude.state, this.now, options.setupStepMs ?? 700);
    this.checkDelayMs = options.setupStepMs ?? 700;
    this.memory = new FakeMemory(this.data, this.now);
    this.topicChanges = new FakeTopicChanges(this.data, this.now);
    this.agentRefresher = new AgentRefresher({
      now: this.now,
      quota: this.quota,
      pr: (key) => {
        const pr = this.data.prs.find((candidate) => candidate.key === key);
        return pr ? { fetchedAt: this.fetchedAtOf(key), updatedAt: pr.updatedAt, state: pr.state } : null;
      },
      topic: (topicId) => this.getTopic(topicId),
      eventCounts: (keys) => new Map(keys.map((key) => [key, this.eventsOf(key).length])),
      read: async (keys) => {
        for (const key of keys) {
          this.fetchedAt.set(key, this.timestamp());
        }
        return { kind: 'ran' };
      },
      log: (outcome, detail) => this.writes.record({ action: 'agent_refresh', origin: 'agent', outcome, detail }),
    });
    this.feedback = [...this.memory.seedFeedback()];
    this.live = new FakeLivePoll(this.data, this.now, (prKey) => isPrInQuietRepo(prKey, this.repoSettings));
    this.writes = new FakeWrites(this.now, {
      revert: (local) => this.revertLocal(local.eventIds, local.handledPrKeys),
      readHere: (scope, clickedAt) => this.readSample(scope, { kind: 'pending_completion', clickedAt }),
      title: (prKeys, threadId) => this.pendingTitle(prKeys, threadId),
      unreadBefore: (cutoff) => this.threadsOnGitHub().filter((thread) => thread.unread && thread.updatedAt < cutoff).map((thread) => thread.id),
    });
    // "Handled quietly" samples, logged like the real sync's quiet mark-reads.
    for (const entry of sampleQuietReads(this.now())) {
      this.writes.record(entry);
    }
    this.pingDecisions = samplePingDecisions(this.now());
    this.workContext = new FakeWorkContext(this.data.topics, this.now, options.sweepDelayMs ?? 2000);
    this.instructions = new FakeInstructions({
    now: this.now,
    newId: () => this.newId(),
    dossiersToRefresh: () => this.memory.topicsWithDossier(),
    findTileMessage: (id) => [...this.chats.values()].flat().find((message) => message.id === id),
    empty: options.forceSetup ?? false,
  });
    this.teamRoles = new FakeTeamRoles(this.data, this.now);
    this.setup = new FakeSetup({
      instructions: this.instructions,
      viewer: () => this.viewer(),
      teamRoles: () => this.teamRoles.view(),
      setQuiet: (repo) => {
        this.repoSettings = withQuietRepo(this.repoSettings, repo, true);
      },
      setScope: (repo) => {
        this.repoSettings = { ...this.repoSettings, scope: normalizeRepoScope(repo) };
      },
      now: this.now,
      forced: options.forceSetup ?? false,
      stepMs: options.setupStepMs ?? 700,
    });
  }

  // -------------------------------------------------------------------------
  // Lookups and derived state
  // -------------------------------------------------------------------------

  private timestamp(): string {
    return this.now().toISOString();
  }

  private newId(): number {
    const id = this.nextId;
    this.nextId += 1;
    return id;
  }

  /** Sample PRs without a glance read as skipped by the call cap, one as failed (FakeCatchUp). */
  private glanceGapOf(prKey: PrKey): GlanceGap | null {
    return this.catchUp.gapOf(prKey);
  }

  /** One sample glance reads as written before the PR's last push, so the stale verdict box can be seen, until refresh on look rewrites it. */
  private isGlanceStale(prKey: PrKey): boolean {
    return STALE_SAMPLE_GLANCES.has(prKey) && !this.catchUp.wrote(prKey) && this.data.glances.some((glance) => glance.prKey === prKey);
  }

  /** Open and tracked in a tile: the PR should have a glance. */
  private wantsGlance(prKey: PrKey): boolean {
    const pr = this.data.prs.find((candidate) => candidate.key === prKey);
    const tracked = this.data.tiles.some((tile) => tile.members.some((member) => member.prKey === prKey && isTracked(member.provenance)));
    return pr?.state === 'OPEN' && tracked;
  }

  /** Same rule as the engine. */
  private glanceStateOfPr(prKey: PrKey): GlanceState {
    return glanceStateOf({
      hasGlance: this.data.glances.some((glance) => glance.prKey === prKey),
      stale: this.isGlanceStale(prKey),
      wanted: this.wantsGlance(prKey),
      gap: this.glanceGapOf(prKey),
      agentOff: this.toolStatus.agentOff() !== null,
      catchUp: this.catchUp.stateOf(prKey),
    });
  }

  /** Same rule as the engine; sample data has no daily cap, so catch-up is always on. */
  private glanceRefreshBlockOfPr(prKey: PrKey): GlanceRefreshBlock | null {
    return glanceRefreshBlockOf({ wanted: this.wantsGlance(prKey), agentOff: this.toolStatus.agentOff() !== null, catchUpOff: false, dailyCapSpent: false });
  }

  /** Sample PRs count as fetched SAMPLE_FETCH_AGE_MS before the engine started, until a fake refresh moves them. */
  private fetchedAtOf(prKey: PrKey): string {
    return this.fetchedAt.get(prKey) ?? new Date(this.startedAt.getTime() - SAMPLE_FETCH_AGE_MS).toISOString();
  }

  private findTile(tileId: string): Tile | undefined {
    return this.data.tiles.find((tile) => tile.id === tileId);
  }

  private eventsOf(prKey: PrKey): PrEvent[] {
    return this.data.events.filter((event) => event.prKey === prKey);
  }

  private userStateOf(prKey: PrKey): UserPrState {
    let state = this.data.userStates.find((candidate) => candidate.prKey === prKey);
    if (!state) {
      state = { prKey, approvedAt: null, approvedCommitOid: null, handledAt: null };
      this.data.userStates.push(state);
    }
    return state;
  }

  private viewer(): Viewer {
    return { login: this.data.viewer, teams: this.data.viewerTeams, homeTeams: this.data.viewerHomeTeams, teamMembers: this.data.viewerTeamMembers };
  }

  private prsByKey(): Map<PrKey, Pr> {
    return new Map(this.data.prs.map((pr) => [pr.key, pr]));
  }

  private userStatesByKey(): Map<PrKey, UserPrState> {
    return new Map(this.data.userStates.map((state) => [state.prKey, state]));
  }

  private eventsByKey(keys: PrKey[]): Map<PrKey, PrEvent[]> {
    return new Map(keys.map((key) => [key, this.eventsOf(key)]));
  }

  /** Sample PRs whose glance says NOT_YOURS, as the engine's Board keeps them. */
  private notYours(): Set<PrKey> {
    return new Set(this.data.glances.filter((glance) => glance.verdict === 'NOT_YOURS').map((glance) => glance.prKey));
  }

  /** The sample PR threads by PR, with their GitHub unread flag as the fake queue left it. */
  private prThreads(): Map<PrKey, NotificationThread> {
    const threads = new Map<PrKey, NotificationThread>();
    for (const thread of this.threadsOnGitHub()) {
      const key = threadPrKey(thread);
      if (key !== null && !threads.has(key)) {
        threads.set(key, thread);
      }
    }
    return threads;
  }

  /** Core's tile state rule over the sample data, snoozes and GitHub unread included. */
  private tileState(tile: Tile): TileState {
    return deriveTileState({
      tile,
      prs: this.prsByKey(),
      events: this.eventsByKey(tile.members.map((member) => member.prKey)),
      threads: this.prThreads(),
      userStates: this.userStatesByKey(),
      snoozes: this.snoozes,
      now: this.timestamp(),
      viewer: this.viewer(),
      notYours: this.notYours(),
    });
  }

  /** Same tier rule as the engine; the sample has no threads, so a pinged member's reason stands in. */
  private tierOf(pr: Pr, member: TileMember | undefined): PrTier {
    const reason = member?.provenance.kind === 'pinged' ? member.provenance.reason : null;
    const userState = this.data.userStates.find((entry) => entry.prKey === pr.key) ?? null;
    return prTier({ pr, events: this.eventsOf(pr.key), viewer: this.viewer(), userState, reason });
  }

  /** Same as the engine: the PR's move is a re-review, which sorts it first under Changes you requested. */
  private isReReview(pr: Pr): boolean {
    const userState = this.data.userStates.find((entry) => entry.prKey === pr.key) ?? null;
    const turn = prWhoseTurn({ pr, events: this.eventsOf(pr.key), userState, viewer: this.viewer(), notYours: this.notYours().has(pr.key) });
    return isReReviewMove(turn);
  }

  /**
   * What the "opened in PostPile" rule reads of a PR, like the engine's
   * OpenedReadInputs. Sample snapshots are always as fresh as their threads.
   */
  private openedReadInput(prKey: PrKey): OpenedReadInput {
    const thread = this.prThreads().get(prKey) ?? null;
    const tiles = this.tilesHolding(prKey);
    const pr = this.prsByKey().get(prKey);
    const tracked = tiles.some((tile) => tile.members.some((member) => member.prKey === prKey && isTracked(member.provenance)));
    const doneAfterRead =
      pr !== undefined &&
      prAfterMarkRead({
        pr,
        events: this.eventsOf(prKey),
        userState: this.data.userStates.find((entry) => entry.prKey === prKey) ?? null,
        viewer: this.viewer(),
        notYours: this.notYours().has(prKey),
        tracked,
        readAt: this.timestamp(),
      }).done;
    return {
      thread,
      prFetchedAt: thread?.updatedAt ?? null,
      pr: pr ?? null,
      tiles: tiles.map((tile) => ({ snoozed: this.tileState(tile).kind === 'snoozed' })),
      doneAfterRead,
    };
  }

  /**
   * Gathers the sample's inputs for core's buildPrSummary / buildTileView,
   * the same rules as the engine. The sample has no threads, so a pinged
   * member's reason stands in for the thread reason. `labels` are the repo
   * labels of the opened topic; none where they do not show (the sidebar counts).
   */
  private tileView(tile: Tile, labels: TileRepoLabels | null = null): TileView {
    const viewer = this.viewer();
    const pending = this.writes.pendingByPrKey();
    const state = this.tileState(tile);
    const prsByKey = this.prsByKey();
    const events = this.eventsByKey(tile.members.map((member) => member.prKey));
    const userStates = this.userStatesByKey();
    const threads = this.prThreads();
    const rows = tile.members.flatMap((member, index): PrSummaryInput[] => {
      const pr = prsByKey.get(member.prKey);
      if (!pr) {
        return [];
      }
      return [
        {
          pr,
          member,
          viewer,
          userState: userStates.get(pr.key) ?? null,
          events: events.get(pr.key) ?? [],
          reason: member.provenance.kind === 'pinged' ? member.provenance.reason : null,
          glance: this.data.glances.find((candidate) => candidate.prKey === pr.key) ?? null,
          glanceStale: this.isGlanceStale(pr.key),
          glanceGap: this.glanceGapOf(pr.key),
          glanceState: this.glanceStateOfPr(pr.key),
          glanceRefreshBlock: this.glanceRefreshBlockOfPr(pr.key),
          quietRepo: isPrInQuietRepo(pr.key, this.repoSettings),
          repoLabel: labels?.prs[index] ?? null,
          tileUnread: state.kind === 'unread',
          unreadOnGitHub: threads.get(pr.key)?.unread === true,
          lastReadAt: threads.get(pr.key)?.lastReadAt ?? null,
          now: this.timestamp(),
          pendingWrite: pending.get(pr.key) ?? null,
          opened: this.openedReadInput(pr.key),
        },
      ];
    });
    return buildTileView({
      tile,
      state,
      prs: rows.map(buildPrSummary),
      agentPrs: rows.map(agentPrFacts),
      prsByKey,
      events,
      userStates,
      viewer,
      notYours: this.notYours(),
      pendingWrite: tile.members.map((member) => pending.get(member.prKey)).find((mark) => mark !== undefined) ?? null,
      quietRepo: isQuietTile(tile.members.map((member) => member.prKey), this.repoSettings),
      repoLabel: labels?.tile ?? null,
      now: this.timestamp(),
    });
  }

  private tilesOfTopic(topicId: string): Tile[] {
    return this.data.tiles.filter((tile) => tile.topicId === topicId);
  }

  private topicPrKeys(topicId: string): PrKey[] {
    return this.tilesOfTopic(topicId).flatMap((tile) => tile.members.map((member) => member.prKey));
  }

  /** Active topics the sidebar lists: with a PR in the chosen repo, like the engine. Their tiles are never narrowed. */
  private listedTopics(scope?: ListScope): Topic[] {
    const settings = scopedSettings(this.repoSettings, scope);
    return this.data.topics.filter((topic) => {
      const keys = this.topicPrKeys(topic.id);
      return topic.status === 'active' && keys.length > 0 && isTopicInScope(keys, settings);
    });
  }

  /** An opened topic: every tile, the ones from another repo labelled. */
  private topicTileViews(topicId: string): TileView[] {
    const baseRepo = labelBaseRepo(this.topicPrKeys(topicId), this.repoSettings);
    const orgs = viewerOrgs(this.data.viewerTeams);
    return this.tilesOfTopic(topicId).map((tile) => {
      const keys = tile.members.map((member) => member.prKey);
      return this.tileView(tile, tileRepoLabels(keys, baseRepo, orgs));
    });
  }

  /** Same landing rules as the engine's debug view, over the sample data. */
  private landingOf(key: PrKey | null): NotificationLanding {
    if (key === null) {
      return { kind: 'not_pr' };
    }
    if (!this.data.prs.some((pr) => pr.key === key)) {
      return { kind: 'pr_not_synced' };
    }
    const holds = (tile: Tile) => tile.members.some((member) => member.prKey === key);
    // Pulled-in layers have no membership and show in their anchor's topic.
    const topicId = this.data.membership.get(key) ?? this.data.tiles.find(holds)?.topicId ?? null;
    const topic = this.data.topics.find((candidate) => candidate.id === topicId);
    if (topicId === null || !topic) {
      return { kind: 'no_topic' };
    }
    if (topic.status !== 'active') {
      return { kind: 'topic_hidden', topicId, topicName: topic.name };
    }
    // Some sample PRs keep their own topic but sit in another topic's set tile.
    const tile = this.tilesOfTopic(topicId).find(holds) ?? this.data.tiles.find(holds);
    const tileTopic = this.data.topics.find((candidate) => candidate.id === tile?.topicId);
    if (!tile || !tileTopic) {
      return { kind: 'no_tile', topicId, topicName: topic.name };
    }
    return {
      kind: 'tile',
      topicId: tileTopic.id,
      topicName: tileTopic.name,
      tileId: tile.id,
      tileTitle: tile.title,
      tileState: this.tileState(tile).kind,
      unsorted: false,
    };
  }

  private recordFeedback(input: Omit<Feedback, 'id' | 'createdAt'>): void {
    this.feedback.push({ ...input, id: this.newId(), createdAt: this.timestamp() });
  }

  // -------------------------------------------------------------------------
  // EngineService: reads
  // -------------------------------------------------------------------------

  async lastSyncReport(): Promise<SyncReport | null> {
    return this.lastSync;
  }

  /** Sample data has no database, so no app ever recorded a version. */
  async recordedAppVersion(): Promise<string | null> {
    return null;
  }

  async databaseSchemaVersion(): Promise<number | null> {
    return null;
  }

  async syncProgress(): Promise<SyncProgress | null> {
    return this.progress ? { ...this.progress, running: [...this.progress.running] } : null;
  }

  /** Like the engine: without gh the sync is skipped with the reason and nothing is stored. */
  private blockedSync(reason: string): SyncReport {
    const at = this.timestamp();
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
      facts: { added: 0, updated: 0, invalidated: 0, confirmed: 0, stale: 0 },
      errors: [],
      blockedBy: reason,
    };
  }

  /** Like the engine: a sync while one runs joins it. */
  sync(): Promise<SyncReport> {
    const ghOff = this.toolStatus.ghOff();
    if (ghOff !== null) {
      return Promise.resolve(this.blockedSync(ghOff));
    }
    if (!this.syncing) {
      this.syncing = this.runFakeSync().finally(() => {
        this.syncing = null;
        this.progress = null;
        this.autoSync?.reschedule();
      });
    }
    return this.syncing;
  }

  private async runFakeSync(): Promise<SyncReport> {
    const startedAt = this.timestamp();
    const progress: SyncProgress = { startedAt, running: [], agentCallsDone: 0, agentCallsPlanned: 0 };
    this.progress = progress;
    // Without claude only the fetch runs, like the engine skipping its agent jobs.
    const agentOff = this.toolStatus.agentOff();
    if (agentOff === null && this.tidyPending) {
      // The tidy is one long agent call; long enough here to look at the overlay.
      this.tidyPending = false;
      progress.running = ['tidy', 'topics'];
      progress.agentCallsPlanned += 1;
      await new Promise((resolve) => setTimeout(resolve, this.syncStepMs * 6));
      progress.agentCallsDone += 1;
    }
    for (const step of agentOff === null ? FAKE_SYNC_STEPS : FAKE_SYNC_STEPS.slice(0, 1)) {
      progress.running = step.running;
      progress.agentCallsPlanned += step.plan;
      await new Promise((resolve) => setTimeout(resolve, this.syncStepMs));
      progress.agentCallsDone += step.done;
    }
    this.lastSync = {
      startedAt,
      finishedAt: this.timestamp(),
      notificationsNotModified: true,
      threads: this.data.tiles.length,
      prsFetched: 0,
      prsSkipped: 0,
      prsPulledIn: 0,
      prsFound: 0,
      newEvents: 0,
      agentCalls: agentOff === null ? 4 : 0,
      agentCallStats: agentOff === null ? sampleSyncStats() : emptyAgentCallStats(),
      dossiersUpdated: agentOff === null ? 2 : 0,
      facts: { added: 0, updated: 0, invalidated: 0, confirmed: 0, stale: 0 },
      errors: [],
      phaseMs: agentOff === null ? { fetch: 2100, topics: 0, dossiers: 38000, facts: 0, sets: 0, glances: 47000, events: 6000 } : { fetch: 2100 },
      agentOff,
    };
    return this.lastSync;
  }

  /** Each PR of the tiles once, with the tile member it came from (for the tier's reason). */
  /** Same as the engine: the topic's PRs per tier and by author, for the list row and the opened topic alike. */
  private topicQueuesOf(tiles: Tile[]): TopicQueues {
    const viewer = this.viewer();
    const pinged = pingedPrKeys(tiles);
    return topicQueues(
      this.topicPrs(tiles).map(({ pr, member }) => ({
        tier: this.tierOf(pr, member),
        author: ownerRelation(pr, viewer),
        state: pr.state,
        pulledIn: !pinged.has(pr.key),
        quiet: isPrInQuietRepo(pr.key, this.repoSettings),
        changesAddressed: this.isReReview(pr),
      })),
    );
  }

  private topicPrs(tiles: Tile[]): { pr: Pr; member: TileMember }[] {
    const found = new Map<PrKey, { pr: Pr; member: TileMember }>();
    for (const member of tiles.flatMap((tile) => tile.members)) {
      const pr = this.data.prs.find((candidate) => candidate.key === member.prKey);
      if (pr && !found.has(pr.key)) {
        found.set(pr.key, { pr, member });
      }
    }
    return [...found.values()];
  }

  onSyncCompleted(): void {}

  async boardShape(): Promise<BoardShapeEvent[]> {
    return [];
  }

  async unreadPrKeys(): Promise<PrKey[]> {
    this.writes.settle();
    const unread = this.data.tiles.filter((tile) => this.tileState(tile).kind === 'unread');
    return [...new Set(unread.flatMap((tile) => tile.members.map((member) => member.prKey)))];
  }

  /** Same lookup as the engine, over the sample tiles. */
  async pingClickTarget(notification: Pick<MacNotification, 'target' | 'prKeys'>): Promise<PingTarget | null> {
    return pingClickTarget(
      notification,
      (key) => {
        const tile = this.data.tiles.find((candidate) => candidate.members.some((member) => member.prKey === key));
        return tile ? { topicId: tile.topicId, tileId: tile.id } : null;
      },
      (topicId) => this.data.topics.some((topic) => topic.id === topicId && topic.status !== 'archived'),
    );
  }

  /** Same urgency rule and order as the engine; ties keep the sample's order. */
  async listTopics(scope?: ListScope): Promise<TopicListItem[]> {
    // A first run without gh: nothing synced yet, so the empty state shows.
    if (this.toolStatus.neverSynced()) {
      return [];
    }
    this.writes.settle();
    const viewer = this.viewer();
    const items = this.listedTopics(scope).map((topic): TopicListItem => {
      const tiles = this.tilesOfTopic(topic.id);
      const views = tiles.map((tile) => this.tileView(tile));
      const urgency = topicUrgency(
        views.map((view) => ({
          state: view.state.kind,
          unreadOnGitHub: view.state.unreadOnGitHub,
          loud: view.state.loud,
          unreadPrKeys: view.unreadPrKeys,
          prStates: view.prs.filter((pr) => !pr.quietRepo).map((pr) => pr.state),
          move: topicMove(view.turn),
          quiet: view.quietRepo,
        })),
      );
      const prs = this.topicPrs(tiles);
      const queues = this.topicQueuesOf(tiles);
      const prRollup = topicPrRollup(tiles, prs.map(({ pr }) => pr));
      return {
        topic,
        statusLine: this.memory.statusLine(topic.id),
        placement: this.memory.placement(topic),
        group: urgency.needsYou ? 'needs_you' : 'quiet',
        unreadTiles: urgency.unreadTiles,
        unreadPrs: urgency.unreadPrs,
        unreadPrKeys: urgency.unreadPrKeys,
        urgentUnreadTiles: urgency.urgentUnreadTiles,
        openTiles: views.filter((view) => view.state.kind === 'open').length,
        totalTiles: views.length,
        yourMoves: urgency.yourMoves,
        unseenMergeTiles: views.filter((view) => (view.state.unseenMerges?.length ?? 0) > 0).length,
        queues,
        section: topicSection(queues),
        people: topicFaces(topicPeople(prs.map(({ pr }) => pr), viewer)),
        prState: prRollup.state,
        prStateCounts: prRollup.counts,
      };
    });
    return items.sort(compareTopicUrgency);
  }

  async listRepos(): Promise<RepoOverview> {
    const active = this.data.topics.filter((topic) => topic.status === 'active');
    return repoOverview(active.map((topic) => this.topicPrKeys(topic.id)), this.repoSettings);
  }

  async setRepoScope(repo: string | null): Promise<RepoOverview> {
    this.repoSettings = { ...this.repoSettings, scope: normalizeRepoScope(repo) };
    return this.listRepos();
  }

  async setRepoQuiet(repo: string, quiet: boolean): Promise<RepoOverview> {
    this.repoSettings = withQuietRepo(this.repoSettings, repo, quiet);
    return this.listRepos();
  }

  async inboxCleanup(): Promise<InboxCleanupView> {
    this.writes.settle();
    const now = this.timestamp();
    const threads = this.threadsOnGitHub();
    const unreadOlderThan14 = unreadOlderThan(threads, cleanupCutoff(now, 14));
    const hiddenUntil = this.cleanupHiddenUntil !== null && this.cleanupHiddenUntil > now ? this.cleanupHiddenUntil : null;
    // Without gh nothing is known about the GitHub inbox.
    const look = this.toolStatus.ghOff() !== null ? 'none' : cleanupLook({ unreadOlderThan14, prominent: this.cleanupProminent, hiddenUntil }, now);
    return {
      unreadOlderThan14,
      unreadOlderThan30: unreadOlderThan(threads, cleanupCutoff(now, 30)),
      look,
      hiddenUntil,
      pendingCutoff: this.writes.pendingCleanupCutoff(),
    };
  }

  async cleanUpInbox(age: CleanupAge): Promise<ActionResult> {
    this.cleanupProminent = false;
    if (!this.writes.cleanup(cleanupCutoff(this.timestamp(), age))) {
      return ok(`Pending: marks everything older than ${age} days read once you unlock and send it from the lock`);
    }
    return ok(`fake: marked the sample threads older than ${age} days read, nothing sent to GitHub`);
  }

  async hideInboxCleanup(): Promise<ActionResult> {
    this.cleanupProminent = false;
    this.cleanupHiddenUntil = new Date(this.now().getTime() + CLEANUP_SNOOZE_DAYS * 24 * 3_600_000).toISOString();
    return ok(`Hidden for ${CLEANUP_SNOOZE_DAYS} days`);
  }

  /** The Archive's sample topics that still take new PRs, newest first, like the engine. Samples keep no join times. */
  async listFinishedTopics(): Promise<FinishedTopic[]> {
    const now = this.now();
    const memberTopicIds = [...this.data.membership.values()];
    return this.data.topics
      .filter((topic) => takesNewPrs(topic, null, now))
      .filter((topic) => topic.status === 'retired')
      .map((topic) => ({
        id: topic.id,
        name: topic.name,
        area: topic.area,
        retiredAt: topic.retiredAt ?? topic.updatedAt,
        prCount: memberTopicIds.filter((topicId) => topicId === topic.id).length,
      }))
      .sort((a, b) => b.retiredAt.localeCompare(a.retiredAt));
  }

  async getViewer(): Promise<ViewerView> {
    return { login: this.data.viewer, teamMembers: this.data.viewerTeamMembers, homeTeams: this.data.viewerHomeTeams };
  }

  async getTeamRoles(): Promise<TeamRolesView> {
    return this.teamRoles.view();
  }

  async setTeamRole(team: string, role: TeamRole): Promise<TeamRolesView> {
    return this.teamRoles.setRole(team, role);
  }

  async getTopic(topicId: string): Promise<TopicDetail | null> {
    this.writes.settle();
    const topic = this.data.topics.find((candidate) => candidate.id === topicId);
    if (!topic) {
      return null;
    }
    const tiles = this.topicTileViews(topicId);
    const topicTiles = this.tilesOfTopic(topicId);
    return {
      topic,
      placement: this.memory.placement(topic),
      tiles,
      yourMoves: topicYourMoves(tiles),
      groupYourMoves: yourMovesByGroup(tiles),
      sets: this.data.sets.filter((set) => set.topicId === topicId && set.status === 'active'),
      setChanges: [],
      pendingProposals: this.topicChanges.pendingForTopic(topicId),
      decidedProposals: this.topicChanges.decidedForTopic(topicId),
      dossier: this.memory.dossierView(topicId, this.feedback),
      agent: topicAgentOffers(tiles),
      archive: this.archiveBox(topic, tiles),
      openInDealtWith: openInDealtWith(tiles),
      prRollup: topicPrRollup(topicTiles, this.topicPrs(topicTiles).map(({ pr }) => pr)),
      section: topicSection(this.topicQueuesOf(topicTiles)),
      memoryUpdating: this.catchUp.memoryUpdating(this.topicPrKeys(topicId)),
    };
  }

  /** Like the engine's, simpler: samples keep no join times or events, so "ready" means every tile is done, no tracked PR is open (pulled-in layers aside, like the gate) and it would go in a day. */
  private archiveBox(topic: Topic, tiles: TileView[]): TopicArchiveBox | null {
    if (topic.status === 'retired') {
      const until = archiveEndsAt(topic, null);
      return until !== null && topic.retiredAt !== null ? { state: 'archived', at: topic.retiredAt, until } : null;
    }
    const nothingLeft =
      topic.status === 'active' &&
      tiles.length > 0 &&
      tiles.every((view) => view.state.kind === 'done') &&
      tiles.every((view) => view.prs.every((pr) => pr.state !== 'OPEN' || pr.provenance.kind === 'pulled_in'));
    return nothingLeft ? { state: 'ready', at: new Date(this.now().getTime() + 24 * 3_600_000).toISOString() } : null;
  }

  /** Same matcher as the engine, over the sample topics the sidebar lists. */
  async search(query: string, scope?: ListScope): Promise<SearchResult> {
    const topics: SearchableTopic[] = this.listedTopics(scope).map((topic) => ({
      topicId: topic.id,
      name: topic.name,
      area: topic.area,
      tiles: this.tilesOfTopic(topic.id).map((tile) => ({
        tileId: tile.id,
        prs: tile.members.flatMap((member) => {
          const pr = this.data.prs.find((candidate) => candidate.key === member.prKey);
          return pr ? [{ key: pr.key, title: pr.title, author: pr.author, headRef: pr.headRef }] : [];
        }),
      })),
    }));
    return searchTopics(topics, query);
  }

  /** The sample threads with their GitHub unread flag as the fake queue left it. */
  private threadsOnGitHub(): NotificationThread[] {
    return sampleThreads(this.data, this.now()).map((thread) => this.writes.onGitHub(thread));
  }

  async debugNotifications(limit: number): Promise<NotificationDebugRow[]> {
    this.writes.settle();
    const actions = this.writes.index();
    const decisions = pingDecisionsByThread(this.pingDecisions);
    return this.threadsOnGitHub()
      .slice(0, limit)
      .map((thread) => {
        const key = threadPrKey(thread);
        return {
          thread,
          prKey: key,
          landing: this.landingOf(key),
          recentEvents: key === null ? [] : debugEventLines(this.eventsOf(key)),
          ...actionTrail(actions, thread.id, key),
          pingDecisions: decisions.get(thread.id) ?? [],
        };
      });
  }

  async handledQuietly(): Promise<QuietReadView[]> {
    this.writes.settle();
    const since = new Date(this.now().getTime() - HANDLED_QUIETLY_DAYS * 24 * 3600_000).toISOString();
    return this.writes
      .recent(1000)
      .filter((entry) => entry.origin === 'quiet' && entry.action === 'mark_read' && entry.outcome === 'github' && entry.prKey !== null && entry.at > since)
      .map((entry) => {
        const key = entry.prKey as PrKey;
        const ref = parsePrKey(key);
        return {
          id: entry.id,
          at: entry.at,
          threadId: entry.threadId,
          prKey: key,
          repo: ref.repo,
          number: ref.number,
          title: this.data.prs.find((pr) => pr.key === key)?.title ?? key,
          reason: quietReasonFromDetail(entry.detail),
          bots: actorsFromQuietDetail(entry.detail),
          landing: this.landingOf(key),
        };
      });
  }

  async actionLog(limit: number): Promise<ActionLogEntry[]> {
    this.writes.settle();
    return this.writes.recent(limit);
  }

  async githubWrites(): Promise<GitHubWritesStatus> {
    this.writes.settle();
    return this.writes.status();
  }

  async setGitHubWrites(enabled: boolean): Promise<GitHubWritesChange> {
    this.writes.settle();
    return { ...this.writes.set(enabled), status: this.writes.status() };
  }

  async sendPendingWrites(): Promise<PendingWritesResult> {
    this.writes.settle();
    return this.writes.sendPending();
  }

  async discardPendingWrites(): Promise<PendingWritesResult> {
    this.writes.settle();
    return this.writes.discardPending();
  }

  async getPr(prKey: PrKey): Promise<PrDetail | null> {
    const pr = this.data.prs.find((candidate) => candidate.key === prKey);
    if (!pr) {
      return null;
    }
    const events: EventView[] = this.eventsOf(prKey)
      .toSorted((a, b) => b.at.localeCompare(a.at))
      .map(eventView);
    const news = whatsNew(pr, this.eventsOf(prKey), this.viewer());
    return {
      pr,
      status: prStatus(pr),
      fetchedAt: this.fetchedAtOf(prKey),
      events,
      activity: activityList(events, this.viewer(), news?.anchor.at ?? null, pr, this.prThreads().get(prKey) ?? null),
      whatsNew: news,
      glance: this.data.glances.find((glance) => glance.prKey === prKey) ?? null,
      glanceStale: this.isGlanceStale(prKey),
      glanceGap: this.glanceGapOf(prKey),
      glanceState: this.glanceStateOfPr(prKey),
      glanceRefreshBlock: this.glanceRefreshBlockOfPr(prKey),
      memoryUpdating: this.catchUp.memoryUpdating(this.topicPrKeys(this.data.membership.get(prKey) ?? '')),
      userState: this.data.userStates.find((state) => state.prKey === prKey) ?? null,
      viewerApproval: viewerApproval(pr, this.data.userStates.find((state) => state.prKey === prKey) ?? null, this.viewer().login),
      agentApprovers: agentOnlyApprovers(standingApprovals(pr)),
      topicId: this.data.membership.get(prKey) ?? null,
      tileIds: this.data.tiles.filter((tile) => tile.members.some((member) => member.prKey === prKey)).map((tile) => tile.id),
      facts: this.memory.prFacts(prKey),
    };
  }

  async getChat(tileId: string): Promise<ChatMessage[]> {
    return this.chats.get(tileId) ?? [];
  }

  // -------------------------------------------------------------------------
  // EngineService: actions
  // -------------------------------------------------------------------------

  async approve(prKey: PrKey, headOid: string): Promise<ActionResult> {
    const pr = this.data.prs.find((candidate) => candidate.key === prKey);
    if (!pr) {
      return fail(`no PR ${prKey}`);
    }
    if (pr.headOid !== headOid) {
      return fail(NEW_COMMITS_SINCE_LOOKED);
    }
    if (!this.writes.isEnabled()) {
      this.writes.record({ action: 'approve', origin: 'tile', outcome: 'skipped', prKey, detail: 'GitHub writes are off' });
      return fail('GitHub writes are off (lock in the footer): nothing was approved');
    }
    this.writes.record({ action: 'approve', origin: 'tile', outcome: 'github', prKey, detail: 'sample data: nothing left the process' });
    const state = this.userStateOf(prKey);
    state.approvedAt = this.timestamp();
    state.approvedCommitOid = pr.headOid;
    for (const event of this.eventsOf(prKey)) {
      event.seenAt ??= this.timestamp();
    }
    return ok(`fake: approved ${prKey} locally, nothing sent to GitHub`);
  }

  /** Like the engine's approveMany: each PR through the fake approve, reported per PR, no undo. */
  async approveMany(prs: ApprovePrRequest[], from: AgentActionFrom): Promise<BatchApproveResult> {
    if (prs.length === 0) {
      return { ok: false, message: 'No PRs to approve', undoToken: null, results: [] };
    }
    const results: PrApproveResult[] = [];
    // Checked up front against the current sample, like the engine; a stack layer waits for the covered layers below it.
    const holding = new Map(prs.map(({ prKey }) => [prKey, this.tilesHolding(prKey).map((tile) => this.tileView(tile))]));
    for (const { prKey, headOid } of prs) {
      const views = holding.get(prKey) ?? [];
      const refusal = agentApproveRefusal(prKey, views, from) ?? agentApproveSkip(prKey, views, from, results);
      if (refusal !== null) {
        results.push({ prKey, ok: false, message: refusal });
        continue;
      }
      const result = await this.approve(prKey, headOid);
      results.push({ prKey, ok: result.ok, message: result.message });
    }
    return { ...approvalsSummary(results), undoToken: null, results };
  }

  /**
   * Like PrActions.removeTeamRequest, in memory: the team leaves the PR's
   * requested teams, the sample thread is unsubscribed (logged only) and the
   * PR is marked done through the fake queue. Nothing leaves the process.
   */
  async removeTeamRequest(prKey: PrKey, team: string): Promise<ActionResult> {
    const index = this.data.prs.findIndex((candidate) => candidate.key === prKey && candidate.state === 'OPEN');
    const pr = this.data.prs[index];
    if (!pr) {
      return fail(`${prKey} is not an open PR in the sample`);
    }
    if (!ownTeamRequests(pr, this.viewer()).includes(team)) {
      return fail(`${team} has no pending review request of your team on ${prKey}`);
    }
    const slug = teamSlug(team);
    if (!this.writes.isEnabled()) {
      this.writes.record({ action: 'remove_team_request', origin: 'detail', outcome: 'skipped', prKey, detail: `team ${slug}: GitHub writes are off` });
      return fail('GitHub writes are off (lock in the footer): nothing was removed');
    }
    this.writes.record({ action: 'remove_team_request', origin: 'detail', outcome: 'github', prKey, detail: `team ${slug}` });
    this.data.prs[index] = { ...pr, reviewerTeams: pr.reviewerTeams.filter((candidate) => candidate !== team) };
    const thread = this.threadsOnGitHub().find((candidate) => threadPrKey(candidate) === prKey);
    let unsubscribed = 'no notification thread known, so not unsubscribed';
    if (thread) {
      this.writes.record({ action: 'unsubscribe', origin: 'detail', outcome: 'github', prKey, threadId: thread.id, detail: 'sample data: nothing left the process' });
      unsubscribed = 'unsubscribed';
    }
    const marked = this.markPrsRead([prKey], [prKey], 'detail', this.tilesHolding(prKey)[0]?.id ?? null);
    const removed = ok(`Removed ${slug}'s review request, ${unsubscribed}`);
    return marked.undoToken ? { ...removed, settleToken: marked.undoToken } : removed;
  }

  /**
   * A read of the sample through core's read planner, like the engine's
   * `readLocally`: the cause says which events turn seen (up to which
   * cutoff) and whether the scope's handle keys turn handled. Returns what
   * changed, for undo and for parking a locked batch.
   */
  private readSample(scope: ReadScope, cause: ReadCause): FakeLocalChange {
    const userStates = new Map(scope.prKeys.map((key) => [key, this.data.userStates.find((state) => state.prKey === key) ?? null]));
    const plan = planRead({ scope, cause, events: this.eventsByKey(scope.prKeys), userStates, at: this.timestamp() });
    const seen = new Set(plan.change.eventIds);
    for (const event of this.data.events.filter((candidate) => seen.has(candidate.id))) {
      event.seenAt = plan.seenAt;
    }
    for (const key of plan.change.handledKeys) {
      this.userStateOf(key).handledAt = plan.handledAt;
    }
    return { eventIds: plan.change.eventIds, handledPrKeys: plan.change.handledKeys };
  }

  private revertLocal(eventIds: string[], handledPrKeys: PrKey[]): void {
    for (const event of this.data.events.filter((candidate) => eventIds.includes(candidate.id))) {
      event.seenAt = null;
    }
    for (const prKey of handledPrKeys) {
      this.userStateOf(prKey).handledAt = null;
    }
  }

  /** Same as the engine: the first PR's title, "(+N)" for the rest. */
  private pendingTitle(prKeys: PrKey[], threadId: string | null): string {
    const pr = this.data.prs.find((candidate) => candidate.key === prKeys[0]);
    if (pr) {
      return prKeys.length > 1 ? `${pr.title} (+${prKeys.length - 1})` : pr.title;
    }
    const thread = this.threadsOnGitHub().find((candidate) => candidate.id === threadId);
    return thread?.title ?? 'notification';
  }

  private markPrsRead(
    prKeys: PrKey[],
    handleKeys: PrKey[],
    origin: 'tile' | 'detail' | 'debug',
    tileId: string | null,
    extraThreads: NotificationThread[] = [],
  ): ActionResult {
    // Read the GitHub flags before the events change: the fake derives a thread's first flag from them.
    const githubThreads = this.threadsOnGitHub();
    const threads = [...githubThreads.filter((thread) => prKeys.includes(threadPrKey(thread) ?? '')), ...extraThreads]
      .filter((thread) => thread.unread)
      .map((thread) => ({ id: thread.id, prKey: threadPrKey(thread) }));
    const writesOn = this.writes.isEnabled();
    // Like ReadMarker: locked with something unread on GitHub, nothing changes until the write goes out.
    const changeHere = writesOn || threads.length === 0;
    const local = changeHere ? this.readSample({ prKeys, handleKeys }, { kind: 'button' }) : { eventIds: [], handledPrKeys: [] };
    const batch: MarkReadBatch = {
      token: `undo-${this.newId()}`,
      batchId: `fake-batch-${this.newId()}`,
      eventIds: local.eventIds,
      handledPrKeys: local.handledPrKeys,
      queuedAt: this.now().getTime(),
    };
    this.batches.push(batch);
    this.writes.queued({ ...batch, origin, tileId, threads, prKeys, handleKeys, local, writesOn });
    if (!changeHere) {
      return ok('Marked read: pending until you unlock GitHub writes, stays unread here until then', batch.token);
    }
    return ok(`marked ${batch.eventIds.length} events read`, batch.token);
  }

  async markRead(tileId: string): Promise<ActionResult> {
    const tile = this.findTile(tileId);
    if (!tile) {
      return fail(`no tile ${tileId}`);
    }
    const keys = tile.members.map((member) => member.prKey);
    const pinged = tile.members.filter((member) => member.provenance.kind !== 'pulled_in').map((member) => member.prKey);
    return this.markPrsRead(keys, pinged, 'tile', tileId);
  }

  /** Like TileActions.markTilesRead: every tile's read in one batch, one undo token. */
  async markTilesRead(tileIds: string[], _from: AgentActionFrom): Promise<ActionResult> {
    const tiles: Tile[] = [];
    for (const tileId of tileIds) {
      const tile = this.findTile(tileId);
      if (!tile) {
        return fail(`no tile ${tileId}`);
      }
      tiles.push(tile);
    }
    if (tiles.length === 0) {
      return fail('no tiles to mark read');
    }
    // Checked against the current sample like the engine: tiles no longer backed are skipped and named.
    const skipped: string[] = [];
    const backed: Tile[] = [];
    for (const tile of tiles) {
      const refusal = agentMarkReadRefusal(this.tileView(tile));
      if (refusal === null) {
        backed.push(tile);
      } else {
        skipped.push(`${tile.title}: ${refusal}`);
      }
    }
    if (backed.length === 0) {
      return fail(`Nothing marked read; skipped ${skipped.join('; ')}`);
    }
    const scope = tilesReadScope(backed);
    const result = this.markPrsRead(scope.prKeys, scope.handleKeys, 'tile', backed.length === 1 ? (backed[0]?.id ?? null) : null);
    return skipped.length === 0 ? result : { ...result, message: `${result.message}; skipped ${skipped.join('; ')}` };
  }

  /** Like TileActions.markPrRead: one PR of the tile, handled unless it is a pulled-in layer. */
  async markPrRead(tileId: string, prKey: PrKey): Promise<ActionResult> {
    const tile = this.findTile(tileId);
    if (!tile) {
      return fail(`no tile ${tileId}`);
    }
    const member = tile.members.find((candidate) => candidate.prKey === prKey);
    if (!member) {
      return fail(`${prKey} is not in tile ${tileId}`);
    }
    return this.markPrsRead([prKey], member.provenance.kind === 'pulled_in' ? [] : [prKey], 'detail', tileId);
  }

  private tilesHolding(prKey: PrKey): Tile[] {
    return this.data.tiles.filter((tile) => tile.members.some((member) => member.prKey === prKey));
  }

  async markThreadRead(threadId: string): Promise<ActionResult> {
    const thread = this.threadsOnGitHub().find((candidate) => candidate.id === threadId);
    if (!thread) {
      return fail(`no notification thread ${threadId}`);
    }
    const key = threadPrKey(thread);
    if (key !== null && this.data.prs.some((pr) => pr.key === key)) {
      return this.markPrsRead([key], [key], 'debug', this.tilesHolding(key)[0]?.id ?? null);
    }
    return this.markPrsRead([], [], 'debug', null, [thread]);
  }

  /**
   * Like OpenedReads.markOpened, in memory: when a mark-read of that PR would
   * leave it done, the PR is marked read like the pane's Mark read (its own
   * batch and undo token), unless nothing would change.
   */
  async markOpenedRead(prKey: PrKey): Promise<OpenedReadResult> {
    this.writes.settle();
    if (!this.writes.isEnabled()) {
      return NOT_OPENED;
    }
    const check = openedReadCheck(this.openedReadInput(prKey));
    if (check.kind === 'skip') {
      return NOT_OPENED;
    }
    if (check.kind === 'handle' && !this.readChangesAnything(prKey)) {
      return NOT_OPENED;
    }
    const marked = this.markPrsRead([prKey], [prKey], 'detail', this.tilesHolding(prKey)[0]?.id ?? null);
    const batch = this.batches.find((candidate) => candidate.token === marked.undoToken);
    const undoUntil = batch ? new Date(batch.queuedAt + UNDO_WINDOW_MS).toISOString() : null;
    return { marked: true, undoToken: marked.undoToken, undoUntil };
  }

  /** Whether a read of the PR changes anything in the sample: unseen events, or not handled yet. */
  private readChangesAnything(prKey: PrKey): boolean {
    const scope = prReadScope(prKey, true);
    const userStates = new Map([[prKey, this.data.userStates.find((state) => state.prKey === prKey) ?? null]]);
    const plan = planRead({ scope, cause: { kind: 'opened' }, events: this.eventsByKey(scope.prKeys), userStates, at: this.timestamp() });
    return plan.change.eventIds.length > 0 || plan.change.handledKeys.length > 0;
  }

  async undo(undoToken: string | null): Promise<ActionResult> {
    const memoryUndo = undoToken ? this.memoryUndos.get(undoToken) : undefined;
    if (undoToken && memoryUndo) {
      this.memoryUndos.delete(undoToken);
      if (memoryUndo.until <= this.now().getTime()) {
        return fail('undo window closed');
      }
      memoryUndo.undo();
      return ok('Undone');
    }
    const index = undoToken ? this.batches.findIndex((batch) => batch.token === undoToken) : this.batches.length - 1;
    const batch = this.batches[index];
    if (!batch) {
      return fail('nothing to undo');
    }
    this.batches.splice(index, 1);
    if (this.now().getTime() - batch.queuedAt > UNDO_WINDOW_MS) {
      return fail('undo window closed');
    }
    this.writes.undone(batch.token);
    this.revertLocal(batch.eventIds, batch.handledPrKeys);
    return ok('undone');
  }

  private applySnoozeWrites(writes: SnoozeWrites): void {
    writes.remove.forEach((key) => this.snoozes.delete(key));
    writes.put.forEach((snooze) => this.snoozes.set(snooze.prKey, snooze));
  }

  async snooze(tileId: string, condition: SnoozeCondition): Promise<ActionResult> {
    const tile = this.findTile(tileId);
    if (!tile) {
      return fail(`no tile ${tileId}`);
    }
    this.applySnoozeWrites(snoozeWrites(tile, { kind: 'start', condition, at: this.timestamp() }));
    return ok(`snoozed until ${condition.kind}`);
  }

  /** Like TileActions.unsnooze: a tile id that no longer exists fails. */
  async unsnooze(tileId: string): Promise<ActionResult> {
    const tile = this.findTile(tileId);
    if (!tile) {
      return fail(`no tile ${tileId}`);
    }
    this.applySnoozeWrites(snoozeWrites(tile, { kind: 'end' }));
    return ok('Unsnoozed');
  }

  /** Agent actions fail with the headline while the agent is off, as the engine's do. */
  private refuseWithoutAgent(): void {
    const agentOff = this.toolStatus.agentOff();
    if (agentOff !== null) {
      throw new Error(agentOff);
    }
  }

  async draftAsk(prKey: PrKey, person: string, intent: string): Promise<{ body: string }> {
    this.refuseWithoutAgent();
    const glance = this.data.glances.find((candidate) => candidate.prKey === prKey);
    const question = intent || 'could you say a bit more about this change?';
    const context = glance ? `\n\n${glance.forYou}` : '';
    return { body: `@${person} ${question}${context}` };
  }

  async sendComment(prKey: PrKey, body: string): Promise<ActionResult> {
    if (!this.writes.isEnabled()) {
      this.writes.record({ action: 'comment', origin: 'tile', outcome: 'skipped', prKey, detail: 'GitHub writes are off' });
      return fail('GitHub writes are off (lock in the footer): the comment was not sent');
    }
    this.writes.record({ action: 'comment', origin: 'tile', outcome: 'github', prKey, detail: 'sample data: nothing left the process' });
    const at = this.timestamp();
    const sourceId = `local-${this.newId()}`;
    this.data.events.push({
      id: `${prKey}:comment:${sourceId}`,
      prKey,
      kind: 'comment',
      actor: this.data.viewer,
      isBot: false,
      at,
      summary: `${this.data.viewer} commented: ${body.split('\n')[0] ?? ''}`,
      url: null,
      sourceId,
      ruleLoudness: 'quiet',
      ruleReason: 'own comment',
      override: null,
      seenAt: at,
    });
    return ok('fake: comment kept locally, nothing sent to GitHub');
  }

  async giveFeedback(input: FeedbackInput): Promise<ActionResult> {
    const tile = this.findTile(input.tileId);
    if (!tile) {
      return fail(`no tile ${input.tileId}`);
    }
    this.recordFeedback({
      kind: input.kind,
      topicId: tile.topicId,
      tileId: tile.id,
      prKey: input.prKey,
      setId: setIdFromTileId(tile.id),
      eventId: null,
      note: input.note,
    });
    if (input.kind === 'not_related' && input.prKey) {
      // A set never tears a layer out of its stack: a stack layer takes its whole stack along.
      const prKey = input.prKey;
      const stack = tile.stacks.find((candidate) => candidate.prKeys.includes(prKey));
      const dropped = stack ? stack.prKeys : [prKey];
      tile.members = tile.members.filter((member) => !dropped.includes(member.prKey));
      tile.stacks = tile.stacks.filter((candidate) => candidate !== stack);
      return ok(`dropped ${dropped.join(', ')} from the set`);
    }
    if (input.kind === 'wrong_topic' && input.targetTopicId) {
      tile.topicId = input.targetTopicId;
      return ok(`moved to ${input.targetTopicId}`);
    }
    if (input.kind === 'not_mine') {
      // Like the engine: a mark-read of the PR (or the whole tile) with undo.
      const keys = input.prKey ? [input.prKey] : tile.members.map((member) => member.prKey);
      const result = this.markPrsRead(keys, keys, 'tile', tile.id);
      return ok(`Noted: not yours, ${result.message}`, result.undoToken);
    }
    return ok('feedback noted');
  }

  async unmuteEvent(eventId: string): Promise<ActionResult> {
    const event = this.data.events.find((candidate) => candidate.id === eventId);
    if (!event) {
      return fail(`no event ${eventId}`);
    }
    const loudness = event.ruleLoudness === 'muted' ? 'quiet' : event.ruleLoudness;
    event.override = { loudness, reason: 'unmuted by the user', by: 'user' };
    const topicId = this.data.membership.get(event.prKey) ?? null;
    this.recordFeedback({ kind: 'unmute', topicId, tileId: null, prKey: event.prKey, setId: null, eventId, note: '' });
    return ok('unmuted');
  }

  async chat(tileId: string, message: string): Promise<ChatReply> {
    this.refuseWithoutAgent();
    const tile = this.findTile(tileId);
    if (!tile) {
      throw new Error(`no tile ${tileId}`);
    }
    const messages = this.chats.get(tileId) ?? [];
    this.chats.set(tileId, messages);
    const userMessage: ChatMessage = { id: this.newId(), tileId, topicId: tile.topicId, role: 'user', text: message, createdAt: this.timestamp() };
    const reply: ChatMessage = {
      id: this.newId(),
      tileId,
      topicId: tile.topicId,
      role: 'agent',
      text: 'Noted. (The fake engine does not think; this is a canned reply.)',
      createdAt: this.timestamp(),
    };
    messages.push(userMessage, reply);
    if (!LASTING.test(message)) {
      return { message: reply, lastingPoint: null };
    }
    return { message: reply, lastingPoint: { topicId: tile.topicId, text: message, sourceChatMessageId: userMessage.id } };
  }

  async decideTailoring(topicId: string, text: string, keep: boolean): Promise<ActionResult> {
    const topic = this.data.topics.find((candidate) => candidate.id === topicId);
    if (!topic) {
      return fail(`no topic ${topicId}`);
    }
    this.recordFeedback({ kind: keep ? 'tailoring_kept' : 'tailoring_once', topicId, tileId: null, prKey: null, setId: null, eventId: null, note: text });
    if (!keep) {
      return ok('used just this once');
    }
    topic.tailoring = topic.tailoring ? `${topic.tailoring}\n${text}` : text;
    topic.updatedAt = this.timestamp();
    return ok('kept as topic tailoring');
  }

  async decideTopicProposal(proposalId: string, accept: boolean): Promise<ActionResult> {
    return this.topicChanges.decide(proposalId, accept);
  }

  async proposeTopicChange(change: TopicChangeRequest, options: { client: string }): Promise<TopicChangeResult> {
    return this.topicChanges.propose(change, options.client);
  }

  /** Sample data has no data folder: the MCP server over sample data answers agent requests in memory instead. */
  startAgentRequests(): void {}

  stopAgentRequests(): void {}

  // Engine memory v2, backed by FakeMemory.

  async listFacts(query: FactQuery): Promise<FactView[]> {
    return this.memory.listFacts(query);
  }

  async listProposals(): Promise<PendingProposals> {
    return { topics: this.topicChanges.pending(), rules: this.memory.pendingRuleProposals() };
  }

  async decideRuleProposal(proposalId: string, accept: boolean): Promise<ActionResult> {
    return this.memory.decideRuleProposal(proposalId, accept, this.data.topics);
  }

  async archiveTopic(topicId: string): Promise<ActionResult> {
    const topic = this.data.topics.find((candidate) => candidate.id === topicId);
    if (!topic) {
      return fail(`no topic ${topicId}`);
    }
    if (this.archiveBox(topic, this.topicTileViews(topicId))?.state !== 'ready') {
      return fail('Something in this topic is still open or unread');
    }
    const at = this.timestamp();
    Object.assign(topic, { status: 'retired', retiredAt: at, updatedAt: at });
    return ok('Moved to the Archive');
  }

  async markTopicSeen(topicId: string): Promise<ActionResult> {
    if (!this.data.topics.some((topic) => topic.id === topicId)) {
      return fail(`no topic ${topicId}`);
    }
    this.memory.markTopicSeen(topicId);
    return ok('Marked seen');
  }

  private memoryUndo(undo: () => void): string {
    const token = `memory:${this.newId()}`;
    this.memoryUndos.set(token, { until: this.now().getTime() + UNDO_WINDOW_MS, undo });
    return token;
  }

  /** Feedback for a correction, and an undo that takes it back out. */
  private logCorrection(kind: FeedbackKind, topicId: string | null, prKey: PrKey | null, note: string): Feedback {
    this.recordFeedback({ kind, topicId, tileId: null, prKey, setId: null, eventId: null, note });
    return this.feedback[this.feedback.length - 1]!;
  }

  private dropFeedback(entry: Feedback): void {
    this.feedback.splice(this.feedback.indexOf(entry), 1);
  }

  /** Same contract as the real engine: a fact changes now, a dossier line waits for the next update. Undoable. */
  async correctMemory(input: MemoryCorrection): Promise<ActionResult> {
    const kind = FAKE_FEEDBACK_KINDS[input.kind];
    const fixed = input.fixedText?.trim() ?? '';
    if (input.kind === 'fix' && fixed === '') {
      return fail('a fix needs the corrected line');
    }
    if (input.factId === null) {
      if (!this.data.topics.some((topic) => topic.id === input.topicId)) {
        return fail(`no topic ${input.topicId ?? ''}`);
      }
      if (input.relation && input.topicId) {
        this.memory.overrideRelation(input.topicId, input.relation);
      }
      let note = input.relation ? `${input.text} (it is actually: ${input.relation})` : input.text;
      if (input.kind === 'fix') {
        note = fixedClaimNote({ text: input.text, fixed });
      }
      const entry = this.logCorrection(kind, input.topicId, null, note);
      const token = this.memoryUndo(() => this.dropFeedback(entry));
      return ok(input.relation ? 'Moved. It stays there until something new happens in the topic.' : FAKE_LINE_MESSAGES[input.kind], token);
    }
    const fact = this.memory.findFact(input.factId);
    if (!fact || fact.invalidAt !== null) {
      return fail(`no fact ${input.factId}`);
    }
    const before = { ...fact };
    const prKey = fact.refs[0]?.prKey ?? null;
    if (input.kind === 'confirm') {
      fact.staleAt = null;
      fact.staleReason = null;
      fact.verifiedAt = this.timestamp();
      const entry = this.logCorrection(kind, fact.topicId, prKey, fact.text);
      return ok('Kept that fact', this.memoryUndo(() => {
        Object.assign(fact, before);
        this.dropFeedback(entry);
      }));
    }
    if (input.kind === 'fix') {
      const replacement = this.memory.replaceFact(fact, fixed, `f-fix-${this.newId()}`);
      const entry = this.logCorrection(kind, fact.topicId, prKey, fixedClaimNote({ text: fact.text, fixed }));
      return ok('Replaced that fact with the corrected one', this.memoryUndo(() => {
        Object.assign(fact, before);
        this.memory.closeFact(replacement.id, 'the user undid the fix');
        this.dropFeedback(entry);
      }));
    }
    this.memory.closeFact(fact.id, 'the user said it is wrong');
    const entry = this.logCorrection(kind, fact.topicId, prKey, fact.text);
    return ok('Forgot that fact', this.memoryUndo(() => {
      Object.assign(fact, before);
      this.dropFeedback(entry);
    }));
  }

  /**
   * Canned answers after a short wait, cycling holds / fix / drop so every
   * dialog state can be seen. No agent, no cap.
   */
  async recheckMemory(request: MemoryRecheckRequest): Promise<MemoryRecheckResult> {
    const agentOff = this.toolStatus.agentOff();
    if (agentOff !== null) {
      return { status: 'unavailable', reason: 'failed', message: `The agent could not check it: ${agentOff}` };
    }
    await new Promise((resolve) => setTimeout(resolve, this.recheckDelayMs));
    const outcome = RECHECK_CYCLE[this.recheckCount % RECHECK_CYCLE.length] ?? 'holds';
    this.recheckCount += 1;
    if (outcome === 'fix') {
      return { status: 'answered', outcome, text: `${request.text.replace(/\.$/, '')} (sample correction).`, why: 'Sample answer: a newer comment on the PR says otherwise.' };
    }
    const why = outcome === 'holds' ? 'Sample answer: the newest review and comments still say the same.' : 'Sample answer: the PR this came from was closed and nobody picked it up.';
    return { status: 'answered', outcome, text: request.text, why };
  }

  async getMemorySources(target: MemoryTarget): Promise<MemorySources | null> {
    return this.memory.sources(target);
  }

  async getInstructions(): Promise<InstructionsView> {
    return this.instructions.view();
  }

  async getInstructionsChat(): Promise<ChatMessage[]> {
    return this.instructions.chatHistory();
  }

  async instructionsChat(message: string): Promise<InstructionsChatReply> {
    this.refuseWithoutAgent();
    return this.instructions.chatMessage(message);
  }

  async proposeInstructions(sourceChatMessageId: number): Promise<InstructionsProposalReply> {
    return this.instructions.proposeFromId(sourceChatMessageId);
  }

  async saveInstructions(decision: InstructionsDecision): Promise<InstructionsSaveResult> {
    return this.instructions.save(decision);
  }

  async getWorkContext(): Promise<WorkContextView> {
    return this.workContext.view();
  }

  sweepWorkContext(): Promise<WorkContextSweepResult> {
    const agentOff = this.toolStatus.agentOff();
    if (agentOff !== null) {
      return Promise.resolve({ ok: false, message: `Work context sweep skipped. ${agentOff}.`, version: null, stats: null });
    }
    return this.workContext.sweep();
  }

  async forgetWorkThread(input: WorkThreadForget): Promise<ActionResult> {
    const forgotten = this.workContext.forget(input);
    if (!forgotten) {
      return fail('That thread is gone; the digest changed meanwhile.');
    }
    return { ...forgotten.result, undoToken: this.memoryUndo(forgotten.undo) };
  }

  async setSweepSkip(patterns: string[]): Promise<ActionResult> {
    return this.workContext.setSkip(patterns);
  }

  /** The fake has no daily schedule; Refresh is enough for UI work. */
  startWorkContextSchedule(): void {}

  stopWorkContextSchedule(): void {}

  async consolidate(): Promise<ConsolidationReport> {
    return this.memory.consolidate();
  }

  // -------------------------------------------------------------------------
  // EngineService: live poll (a new sample question every ~45s)
  // -------------------------------------------------------------------------

  async pollOnce(): Promise<PollCycle> {
    const ghOff = this.toolStatus.ghOff();
    if (ghOff !== null) {
      return { kind: 'blocked', reason: ghOff };
    }
    const cycle = this.live.poll();
    if (cycle.kind === 'done') {
      this.pingDecisions.push(...cycle.decisions);
    }
    return cycle;
  }

  /** The real scheduler and burst grouping over the fake poll. */
  startLivePoll(options: LivePollOptions): void {
    if (this.livePoller) {
      return;
    }
    this.livePoller = new LivePoller(() => this.pollOnce(), systemTimers, options, this.quota);
    this.livePoller.start();
  }

  stopLivePoll(): void {
    this.livePoller?.stop();
    this.livePoller = null;
  }

  async livePollStatus(): Promise<LivePollStatus> {
    // The renderer asks this every 5s from load: the sample catch-up starts once someone watches, so it can be seen.
    this.catchUp.seedOnce();
    const poll = this.livePoller?.currentStatus() ?? OFF_POLL_STATUS;
    return {
      ...poll,
      syncRunning: this.syncing !== null,
      nextAutoSyncAt: this.autoSync?.nextSyncAt() ?? null,
      catchUpChanges: this.catchUp.changes(),
      githubQuota: this.quota.view(poll.everySeconds),
    };
  }

  /** The real schedule over the fake sync, so the title bar shows a background sync like a normal one. */
  startAutoSync(options: AutoSyncOptions): void {
    if (this.autoSync) {
      return;
    }
    const target = { isSyncing: () => this.syncing !== null, pausedUntil: () => this.quota.backgroundPausedUntil(), sync: () => this.sync() };
    this.autoSync = new AutoSyncSchedule(target, systemTimers, options, (line) => console.log(line));
    this.autoSync.start();
  }

  stopAutoSync(): void {
    this.autoSync?.stop();
    this.autoSync = null;
  }

  async retryGlance(prKey: PrKey): Promise<ActionResult> {
    const agentOff = this.toolStatus.agentOff();
    if (agentOff !== null) {
      return fail(`Agent features are off: ${agentOff}`);
    }
    if (!this.data.prs.some((pr) => pr.key === prKey)) {
      return fail(`${prKey} is not synced yet.`);
    }
    return this.catchUp.retry(prKey);
  }

  /** The real engine's order over sample data: a stale sample glance looked at is rewritten by the fake catch-up. */
  async refreshGlanceOnLook(prKey: PrKey): Promise<GlanceLookResult> {
    if (this.toolStatus.agentOff() !== null) {
      return { outcome: 'blocked' };
    }
    if (!this.data.prs.some((pr) => pr.key === prKey)) {
      return { outcome: 'skipped' };
    }
    if (this.syncing !== null) {
      // Asked again once the fake sync ends, like the engine does.
      void this.syncing.catch(() => {}).then(() => this.refreshGlanceOnLook(prKey));
      return { outcome: 'deferred' };
    }
    if (!this.isGlanceStale(prKey)) {
      return { outcome: 'current' };
    }
    return { outcome: this.catchUp.refreshOnLook(prKey) };
  }

  /** Sample data never changes on GitHub; one poll cycle (debounced) keeps the flow the same as the real engine. */
  async refreshOnFocus(): Promise<void> {
    await this.livePoller?.runOnFocus();
  }

  /** The real refresh rules over sample data: a "read" only moves the PRs' fetch time; nothing changes on GitHub. */
  refreshNow(target: AgentRefreshTarget, options: AgentRefreshOptions): Promise<AgentRefreshResult> {
    return this.agentRefresher.refresh(target, options.client);
  }

  // -------------------------------------------------------------------------
  // Setup flow (canned, see FakeSetup)
  // -------------------------------------------------------------------------

  async setupStatus(): Promise<SetupStatus> {
    return this.setup.status();
  }

  async setupChecks(): Promise<SetupChecksView> {
    return this.toolStatus.setupChecks(await this.setup.checks());
  }

  async tools(): Promise<ToolsView> {
    return this.toolStatus.view();
  }

  /** Waits a moment like a real check, then finds the same simulated problems. */
  async checkTools(): Promise<ToolsView> {
    await new Promise((resolve) => setTimeout(resolve, this.checkDelayMs));
    return this.toolStatus.check();
  }

  async mcpConnection(): Promise<McpConnectionView> {
    return this.mcp.view();
  }

  connectMcp(): Promise<ActionResult> {
    return this.mcp.connect();
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
    const agentOff = this.toolStatus.agentOff();
    if (agentOff !== null) {
      return Promise.resolve({ ok: false, message: `The agent could not change the draft: ${agentOff}`, draft: null, changedSections: [] });
    }
    return this.setup.refine(request);
  }

  checkSetupFit(request: SetupFitRequest): Promise<SetupFitResult> {
    const agentOff = this.toolStatus.agentOff();
    if (agentOff !== null) {
      return Promise.resolve({ ok: false, message: `The agent could not check the text: ${agentOff}`, notes: [] });
    }
    return this.setup.checkFit(request);
  }

  async acceptSetup(request: SetupAcceptRequest): Promise<SetupAcceptResult> {
    return this.setup.accept(request);
  }

  async skipSetup(): Promise<ActionResult> {
    return this.setup.skip();
  }

  async flushPendingWrites(): Promise<void> {
    // Nothing leaves the process; the fake queue only logs and flips sample flags.
    this.writes.flush();
    this.batches.length = 0;
  }

  async close(): Promise<void> {
    this.stopLivePoll();
    this.stopAutoSync();
  }
}
