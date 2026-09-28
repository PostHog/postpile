import type { AgentService } from '@code-manager/agent';
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
  InstructionsChatReply,
  InstructionsDecision,
  InstructionsProposalReply,
  InstructionsSaveResult,
  InstructionsView,
  LivePollStatus,
  MemoryCorrection,
  MemoryRecheckRequest,
  MemoryRecheckResult,
  MemorySources,
  MemoryTarget,
  PendingProposals,
  PrDetail,
  PrKey,
  SearchResult,
  SnoozeCondition,
  SyncOptions,
  SyncReport,
  TopicDetail,
  TopicListItem,
  ViewerView,
  NotificationDebugRow,
  Timers,
} from '@code-manager/core';
import { OFF_POLL_STATUS, systemTimers } from '@code-manager/core';
import type { GitHubReader } from '@code-manager/github';
import type { Store } from '@code-manager/store';
import { ChatActions } from './actions/chat-actions.ts';
import { FeedbackActions } from './actions/feedback-actions.ts';
import { InstructionsActions } from './actions/instructions-actions.ts';
import { PrActions } from './actions/pr-actions.ts';
import { MemoryActions } from './actions/memory-actions.ts';
import { ProposalActions } from './actions/proposal-actions.ts';
import { ReadMarker } from './actions/read-marker.ts';
import { TileActions } from './actions/tile-actions.ts';
import type { AgentCallLog } from './agent-call-log.ts';
import { ConsolidationRun } from './consolidation/consolidation-run.ts';
import { GitHubSync } from './github-sync.ts';
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
import type { EngineService } from './service.ts';
import { SyncRun } from './sync-run.ts';
import type { GitHubWrites } from './writes/github-writes.ts';

export interface EngineDeps {
  store: Store;
  reader: GitHubReader;
  /** The only way to GitHub writes: asks the footer lock and logs every call. The queue must use the same one. */
  writes: GitHubWrites;
  agent: AgentService;
  /** Must be the observer the agent service reports its calls to; the run stats come from it. */
  callLog: AgentCallLog;
  markReadQueue: MarkReadQueue;
  instructionsFile: string;
  now: () => Date;
  /** Clock for the live poll. Defaults to the system timers. */
  timers?: Timers;
  /** Daily cap on ping_decision calls. Defaults to PING_DECISIONS_PER_DAY. */
  pingDecisionsPerDay?: number;
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
  private syncing: Promise<SyncReport> | null = null;
  private consolidating: Promise<ConsolidationReport> | null = null;
  private polling: Promise<PollCycle> | null = null;
  private livePoller: LivePoller | null = null;

  constructor(private readonly deps: EngineDeps) {
    const { store, now } = deps;
    const history = new InstructionsHistory(store, deps.instructionsFile, now);
    const proposer = new InstructionsProposer(store, deps.agent, history);
    const contexts = new PromptContextSource(store, history);
    this.reads = new ReadModels(store, deps.agent, contexts, now);
    const log = deps.writes.log;
    const readMarker = new ReadMarker(store, deps.markReadQueue, log, now);
    this.tiles = new TileActions(store, readMarker, log, now);
    this.prActions = new PrActions(store, deps.writes, deps.agent, contexts, readMarker, now);
    this.feedback = new FeedbackActions(store, readMarker, now);
    this.chats = new ChatActions(store, deps.agent, contexts, now);
    this.proposals = new ProposalActions(store, now);
    this.memoryActions = new MemoryActions(store, now);
    this.memorySources = new MemorySourcesReads(store, now);
    this.rechecker = new MemoryRechecker(store, deps.agent, contexts, this.memorySources, now);
    this.instructions = new InstructionsActions(store, history, proposer, now);
    const runDeps = { store, agent: deps.agent, contexts, callLog: deps.callLog, facts: new FactWriter(store, now), now };
    const github = new GitHubSync(store, deps.reader, contexts, now, log);
    this.syncRun = new SyncRun(runDeps, github, deps.markReadQueue);
    this.consolidationRun = new ConsolidationRun(runDeps);
    const decider = new PingDecider({
      store,
      agent: deps.agent,
      contexts,
      now,
      capPerDay: deps.pingDecisionsPerDay ?? PING_DECISIONS_PER_DAY,
    });
    this.pollRun = new PollRun(runDeps, github, decider);
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
      this.polling = this.pollRun.run().finally(() => {
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

  async livePollStatus(): Promise<LivePollStatus> {
    return this.livePoller?.currentStatus() ?? OFF_POLL_STATUS;
  }

  async listTopics(): Promise<TopicListItem[]> {
    return this.reads.listTopics();
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

  async githubWrites(): Promise<GitHubWritesStatus> {
    return this.deps.writes.status();
  }

  async setGitHubWrites(enabled: boolean): Promise<GitHubWritesChange> {
    return this.deps.writes.set(enabled);
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

  async bringBack(prKey: PrKey): Promise<ActionResult> {
    return this.tiles.bringBack(prKey);
  }

  async undo(undoToken: string | null): Promise<ActionResult> {
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

  flushPendingWrites(): Promise<void> {
    return this.deps.markReadQueue.flush();
  }

  async close(): Promise<void> {
    this.stopLivePoll();
    await this.polling?.catch(() => {});
    await this.syncing?.catch(() => {});
    await this.consolidating?.catch(() => {});
    this.deps.store.close();
  }
}
