import type { AgentService } from '@postpile/agent';
import type {
  ActionLogEntry,
  ActionResult,
  ChatMessage,
  ChatReply,
  ConsolidateOptions,
  ConsolidationReport,
  FactQuery,
  FactView,
  FeedbackInput,
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
  SnoozeCondition,
  SyncOptions,
  SyncReport,
  TopicDetail,
  TopicListItem,
  ViewerView,
  NotificationDebugRow,
  Timers,
  WorkContextSweepResult,
  WorkContextView,
  WorkThreadForget,
} from '@postpile/core';
import { normalizeRepoScope, OFF_POLL_STATUS, parsePrKey, systemTimers, withQuietRepo } from '@postpile/core';
import type { GitHubReader } from '@postpile/github';
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
import { ConsolidationRun } from './consolidation/consolidation-run.ts';
import { errorText } from './errors.ts';
import { GitHubSync, NO_FOCUS, type PollFocus } from './github-sync.ts';
import type { MarkReadQueue } from './mark-read-queue.ts';
import { InstructionsHistory } from './instructions/history.ts';
import { InstructionsProposer } from './instructions/proposer.ts';
import { LivePoller } from './live/live-poller.ts';
import { PING_DECISIONS_PER_DAY, PingDecider } from './live/ping-decider.ts';
import type { LivePollOptions, PollCycle } from './live/poll-cycle.ts';
import { PollRun } from './live/poll-run.ts';
import { FactWriter } from './memory/fact-writer.ts';
import { MemoryRechecker } from './memory/memory-recheck.ts';
import { MemorySourcesReads } from './memory/memory-sources-reads.ts';
import { PromptContextSource } from './prompt-context.ts';
import { ReadModels } from './read-models.ts';
import { loadRepoSettings, saveRepoSettings } from './repo-settings.ts';
import type { EngineService } from './service.ts';
import { loadLastSyncReport } from './last-sync-report.ts';
import { SyncRun } from './sync-run.ts';
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
  /** The database folder's lock; released on close. Null in tests and read-only CLI access. */
  dataLock?: { release(): void } | null;
  /** Local Claude Code folder the work context sweep reads. Defaults to POSTPILE_CLAUDE_DIR, else ~/.claude. */
  claudeDir?: string;
  /** The user's config.json (sweep skip list). Null or missing: none, e.g. in tests. */
  userConfig?: UserConfigFile | null;
  /** Sync start, summary and errors. Defaults to console.log, which the desktop app writes to its log file. */
  syncLog?: (line: string) => void;
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
  private syncing: Promise<SyncReport> | null = null;
  private consolidating: Promise<ConsolidationReport> | null = null;
  private polling: Promise<PollCycle> | null = null;
  private livePoller: LivePoller | null = null;
  private readonly github: GitHubSync;
  /** What the next poll cycle also looks at, set by refreshOnFocus. */
  private focus: PollFocus = NO_FOCUS;

  constructor(private readonly deps: EngineDeps) {
    const { store, now } = deps;
    const history = new InstructionsHistory(store, deps.instructionsFile, now);
    const proposer = new InstructionsProposer(store, deps.agent, history);
    this.sweeper = new WorkContextSweeper({
      store,
      agent: deps.agent,
      history,
      claudeDir: deps.claudeDir ?? claudeDirFromEnv(),
      now,
      config: deps.userConfig ?? null,
    });
    this.workContext = new WorkContextMemory(store, this.sweeper, now);
    this.sweepSchedule = new WorkContextSchedule(this.sweeper, deps.timers ?? systemTimers, now);
    const contexts = new PromptContextSource(store, history, () => this.workContext.promptText());
    this.reads = new ReadModels(store, deps.agent, contexts, now, deps.pendingWrites);
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
    const runDeps = { store, agent: deps.agent, contexts, callLog: deps.callLog, facts: new FactWriter(store, now), now };
    const github = new GitHubSync(store, deps.reader, contexts, now, log, deps.pendingWrites, deps.syncLog ?? ((line) => console.log(line)));
    this.github = github;
    this.syncRun = new SyncRun(runDeps, github, deps.markReadQueue, deps.syncLog);
    this.consolidationRun = new ConsolidationRun(runDeps);
    const decider = new PingDecider({
      store,
      agent: deps.agent,
      contexts,
      now,
      capPerDay: deps.pingDecisionsPerDay ?? PING_DECISIONS_PER_DAY,
    });
    this.pollRun = new PollRun(runDeps, github, decider);
    this.cleanup = new InboxCleanup(store, deps.writes, deps.pendingWrites, now, () => this.rereadInbox());
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
  sync(options: SyncOptions = {}): Promise<SyncReport> {
    if (!this.syncing) {
      const before = Engine.settled([this.consolidating, this.polling]);
      this.syncing = before
        .then(() => this.syncRun.run(options))
        .finally(() => {
          this.syncing = null;
          // The poll was blocked while the sync ran; catch up on what happened meanwhile.
          void this.livePoller?.runCycle();
        });
    }
    return this.syncing;
  }

  consolidate(options: ConsolidateOptions = {}): Promise<ConsolidationReport> {
    if (!this.consolidating) {
      const before = Engine.settled([this.syncing, this.polling]);
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
    if (!this.polling) {
      const focus = this.focus;
      this.focus = NO_FOCUS;
      this.polling = this.pollRun.run(focus).finally(() => {
        this.polling = null;
      });
    }
    return this.polling;
  }

  startLivePoll(options: LivePollOptions): void {
    if (this.livePoller) {
      return;
    }
    this.livePoller = new LivePoller(() => this.pollOnce(), this.deps.timers ?? systemTimers, options);
    this.livePoller.start();
  }

  stopLivePoll(): void {
    this.livePoller?.stop();
    this.livePoller = null;
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

  async livePollStatus(): Promise<LivePollStatus> {
    return this.livePoller?.currentStatus() ?? OFF_POLL_STATUS;
  }

  async syncProgress(): Promise<SyncProgress | null> {
    return this.syncRun.progress();
  }

  async lastSyncReport(): Promise<SyncReport | null> {
    return loadLastSyncReport(this.deps.store);
  }

  async listTopics(): Promise<TopicListItem[]> {
    return this.reads.listTopics();
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

  approve(prKey: PrKey): Promise<ActionResult> {
    return this.prActions.approve(prKey);
  }

  async markRead(tileId: string): Promise<ActionResult> {
    return this.tiles.markRead(tileId);
  }

  async markThreadRead(threadId: string): Promise<ActionResult> {
    return this.tiles.markThreadRead(threadId);
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
    return this.tiles.snooze(tileId, condition);
  }

  async unsnooze(tileId: string): Promise<ActionResult> {
    return this.tiles.unsnooze(tileId);
  }

  draftAsk(prKey: PrKey, person: string, intent: string): Promise<{ body: string }> {
    return this.prActions.draftAsk(prKey, person, intent);
  }

  sendComment(prKey: PrKey, body: string): Promise<ActionResult> {
    return this.prActions.sendComment(prKey, body);
  }

  async giveFeedback(input: FeedbackInput): Promise<ActionResult> {
    return this.feedback.giveFeedback(input);
  }

  async unmuteEvent(eventId: string): Promise<ActionResult> {
    return this.feedback.unmuteEvent(eventId);
  }

  chat(tileId: string, message: string): Promise<ChatReply> {
    return this.chats.chat(tileId, message);
  }

  async decideTailoring(topicId: string, text: string, keep: boolean): Promise<ActionResult> {
    return this.chats.decideTailoring(topicId, text, keep);
  }

  async decideTopicProposal(proposalId: string, accept: boolean): Promise<ActionResult> {
    return this.proposals.decide(proposalId, accept);
  }

  async search(query: string): Promise<SearchResult> {
    return this.reads.search(query);
  }

  async listFacts(query: FactQuery): Promise<FactView[]> {
    return this.reads.listFacts(query);
  }

  async listProposals(): Promise<PendingProposals> {
    return this.memoryActions.listProposals();
  }

  async decideRuleProposal(proposalId: string, accept: boolean): Promise<ActionResult> {
    return this.memoryActions.decideRuleProposal(proposalId, accept);
  }

  async markTopicSeen(topicId: string): Promise<ActionResult> {
    return this.memoryActions.markTopicSeen(topicId);
  }

  async correctMemory(input: MemoryCorrection): Promise<ActionResult> {
    return this.memoryActions.correctMemory(input);
  }

  recheckMemory(request: MemoryRecheckRequest): Promise<MemoryRecheckResult> {
    return this.rechecker.recheck(request);
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

  saveInstructions(decision: InstructionsDecision): Promise<InstructionsSaveResult> {
    return this.instructions.save(decision);
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

  flushPendingWrites(): Promise<void> {
    return this.deps.markReadQueue.flush();
  }

  async close(): Promise<void> {
    this.stopLivePoll();
    // A running sweep is not awaited (it can take minutes); its late write fails quietly.
    this.stopWorkContextSchedule();
    await this.polling?.catch(() => {});
    await this.syncing?.catch(() => {});
    await this.consolidating?.catch(() => {});
    this.deps.store.close();
    this.deps.dataLock?.release();
  }
}
