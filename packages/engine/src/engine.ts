import type { AgentService } from '@code-manager/agent';
import type {
  ActionResult,
  ChatMessage,
  ChatReply,
  ConsolidateOptions,
  ConsolidationReport,
  FactQuery,
  FactView,
  FeedbackInput,
  InstructionsChatReply,
  InstructionsDecision,
  InstructionsProposalReply,
  InstructionsSaveResult,
  InstructionsView,
  MemoryCorrection,
  MemorySources,
  MemoryTarget,
  PendingProposals,
  PrDetail,
  PrKey,
  SnoozeCondition,
  SyncOptions,
  SyncReport,
  TopicDetail,
  TopicListItem,
} from '@code-manager/core';
import type { GitHubReader, GitHubWriter } from '@code-manager/github';
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
import { FactWriter } from './memory/fact-writer.ts';
import { MemorySourcesReads } from './memory/memory-sources-reads.ts';
import { PromptContextSource } from './prompt-context.ts';
import { ReadModels } from './read-models.ts';
import type { EngineService } from './service.ts';
import { SyncRun } from './sync-run.ts';

export interface EngineDeps {
  store: Store;
  reader: GitHubReader;
  writer: GitHubWriter;
  agent: AgentService;
  /** Must be the observer the agent service reports its calls to; the run stats come from it. */
  callLog: AgentCallLog;
  markReadQueue: MarkReadQueue;
  instructionsFile: string;
  now: () => Date;
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
  private readonly instructions: InstructionsActions;
  private readonly syncRun: SyncRun;
  private readonly consolidationRun: ConsolidationRun;
  private syncing: Promise<SyncReport> | null = null;
  private consolidating: Promise<ConsolidationReport> | null = null;

  constructor(private readonly deps: EngineDeps) {
    const { store, now } = deps;
    const history = new InstructionsHistory(store, deps.instructionsFile, now);
    const proposer = new InstructionsProposer(store, deps.agent, history);
    const contexts = new PromptContextSource(store, history);
    this.reads = new ReadModels(store, deps.agent, contexts, now);
    const readMarker = new ReadMarker(store, deps.markReadQueue, now);
    this.tiles = new TileActions(store, readMarker, now);
    this.prActions = new PrActions(store, deps.writer, deps.agent, contexts, readMarker, now);
    this.feedback = new FeedbackActions(store, readMarker, now);
    this.chats = new ChatActions(store, deps.agent, contexts, proposer, now);
    this.proposals = new ProposalActions(store, now);
    this.memoryActions = new MemoryActions(store, now);
    this.memorySources = new MemorySourcesReads(store, now);
    this.instructions = new InstructionsActions(store, history, proposer, now);
    const runDeps = { store, agent: deps.agent, contexts, callLog: deps.callLog, facts: new FactWriter(store, now), now };
    this.syncRun = new SyncRun(runDeps, new GitHubSync(store, deps.reader, contexts, now), deps.markReadQueue);
    this.consolidationRun = new ConsolidationRun(runDeps);
  }

  /**
   * A sync while one is running joins the running one. Sync and consolidation
   * never overlap: each waits for the other, so agent calls land in the right run.
   */
  sync(options: SyncOptions = {}): Promise<SyncReport> {
    if (!this.syncing) {
      const before = this.consolidating?.catch(() => {}) ?? Promise.resolve();
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
      const before = this.syncing?.catch(() => {}) ?? Promise.resolve();
      this.consolidating = before
        .then(() => this.consolidationRun.run(options))
        .finally(() => {
          this.consolidating = null;
        });
    }
    return this.consolidating;
  }

  async listTopics(): Promise<TopicListItem[]> {
    return this.reads.listTopics();
  }

  async getTopic(topicId: string): Promise<TopicDetail | null> {
    return this.reads.getTopic(topicId);
  }

  async getPr(prKey: PrKey): Promise<PrDetail | null> {
    return this.reads.getPr(prKey);
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

  async undo(undoToken: string | null): Promise<ActionResult> {
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

  proposeInstructions(sourceChatMessageId: number, point: string, topicId: string | null): Promise<InstructionsProposalReply> {
    return this.instructions.propose(sourceChatMessageId, point, topicId);
  }

  saveInstructions(decision: InstructionsDecision): Promise<InstructionsSaveResult> {
    return this.instructions.save(decision);
  }

  flushPendingWrites(): Promise<void> {
    return this.deps.markReadQueue.flush();
  }

  async close(): Promise<void> {
    await this.syncing?.catch(() => {});
    await this.consolidating?.catch(() => {});
    this.deps.store.close();
  }
}
