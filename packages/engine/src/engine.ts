import type { AgentService } from '@code-manager/agent';
import {
  ALL_AGENT_JOBS,
  type ActionResult,
  type ChatMessage,
  type ChatReply,
  type FeedbackInput,
  type PrDetail,
  type PrKey,
  type SnoozeCondition,
  type SyncOptions,
  type SyncReport,
  type TopicDetail,
  type TopicListItem,
} from '@code-manager/core';
import type { GitHubReader, GitHubWriter } from '@code-manager/github';
import type { Store } from '@code-manager/store';
import { ChatActions } from './actions/chat-actions.ts';
import { FeedbackActions } from './actions/feedback-actions.ts';
import { PrActions } from './actions/pr-actions.ts';
import { ProposalActions } from './actions/proposal-actions.ts';
import { ReadMarker } from './actions/read-marker.ts';
import { TileActions } from './actions/tile-actions.ts';
import { AgentBudget } from './budget.ts';
import { Digester } from './digest/digester.ts';
import { errorText } from './errors.ts';
import { GitHubSync } from './github-sync.ts';
import type { MarkReadQueue } from './mark-read-queue.ts';
import { PromptContextSource } from './prompt-context.ts';
import { ReadModels } from './read-models.ts';
import type { EngineService } from './service.ts';

export interface EngineDeps {
  store: Store;
  reader: GitHubReader;
  writer: GitHubWriter;
  agent: AgentService;
  markReadQueue: MarkReadQueue;
  instructionsFile: string;
  now: () => Date;
}

/** EngineService over the store, GitHub and the agent. Each concern lives in its own small class. */
export class Engine implements EngineService {
  private readonly contexts: PromptContextSource;
  private readonly github: GitHubSync;
  private readonly reads: ReadModels;
  private readonly tiles: TileActions;
  private readonly prActions: PrActions;
  private readonly feedback: FeedbackActions;
  private readonly chats: ChatActions;
  private readonly proposals: ProposalActions;
  private running: Promise<SyncReport> | null = null;

  constructor(private readonly deps: EngineDeps) {
    const { store, now } = deps;
    this.contexts = new PromptContextSource(store, deps.instructionsFile);
    this.github = new GitHubSync(store, deps.reader, this.contexts, now);
    this.reads = new ReadModels(store, deps.agent, this.contexts, now);
    const readMarker = new ReadMarker(store, deps.markReadQueue, now);
    this.tiles = new TileActions(store, readMarker, now);
    this.prActions = new PrActions(store, deps.writer, deps.agent, this.contexts, readMarker, now);
    this.feedback = new FeedbackActions(store, readMarker, now);
    this.chats = new ChatActions(store, deps.agent, this.contexts, now);
    this.proposals = new ProposalActions(store, now);
  }

  private async runSync(options: SyncOptions): Promise<SyncReport> {
    const startedAt = this.deps.now().toISOString();
    const errors: string[] = [];
    const budget = new AgentBudget(options.maxAgentCalls ?? Number.POSITIVE_INFINITY);
    const report: SyncReport = {
      startedAt,
      finishedAt: startedAt,
      notificationsNotModified: false,
      threads: 0,
      prsFetched: 0,
      prsSkipped: 0,
      newEvents: 0,
      agentCalls: 0,
      errors,
    };
    try {
      const fetched = await this.github.run(options.maxPrs ?? Number.POSITIVE_INFINITY);
      report.notificationsNotModified = fetched.notModified;
      report.threads = fetched.threads;
      report.prsFetched = fetched.prsFetched;
      report.prsSkipped = fetched.prsSkipped;
      report.newEvents = fetched.newEventIds.length;

      const digester = new Digester({
        store: this.deps.store,
        agent: this.deps.agent,
        contexts: this.contexts,
        budget,
        viewer: fetched.viewer,
        errors,
        now: this.deps.now,
      });
      await digester.run(options.agentJobs ?? ALL_AGENT_JOBS, fetched.newEventIds);
    } catch (error) {
      errors.push(`sync: ${errorText(error)}`);
    }
    // Mark-reads run in the background; the sync report is where the user hears about them.
    errors.push(...this.deps.markReadQueue.takeNotes());
    report.agentCalls = budget.calls;
    report.finishedAt = this.deps.now().toISOString();
    return report;
  }

  sync(options: SyncOptions = {}): Promise<SyncReport> {
    if (!this.running) {
      this.running = this.runSync(options).finally(() => {
        this.running = null;
      });
    }
    return this.running;
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

  flushPendingWrites(): Promise<void> {
    return this.deps.markReadQueue.flush();
  }

  async close(): Promise<void> {
    await this.running?.catch(() => {});
    this.deps.store.close();
  }
}
