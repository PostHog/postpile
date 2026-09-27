import type {
  ActionResult,
  ChatMessage,
  ChatReply,
  FeedbackInput,
  PrDetail,
  PrKey,
  SnoozeCondition,
  SyncReport,
  TopicDetail,
  TopicListItem,
} from '@code-manager/core';
import type { AgentService } from '@code-manager/agent';
import type { GitHubReader, GitHubWriter } from '@code-manager/github';
import type { Store } from '@code-manager/store';
import type { MarkReadQueue } from './mark-read-queue.ts';
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

export class Engine implements EngineService {
  constructor(private readonly deps: EngineDeps) {}

  sync(): Promise<SyncReport> {
    throw new Error('not implemented');
  }

  listTopics(): Promise<TopicListItem[]> {
    throw new Error('not implemented');
  }

  getTopic(_topicId: string): Promise<TopicDetail | null> {
    throw new Error('not implemented');
  }

  getPr(_prKey: PrKey): Promise<PrDetail | null> {
    throw new Error('not implemented');
  }

  getChat(_tileId: string): Promise<ChatMessage[]> {
    throw new Error('not implemented');
  }

  approve(_prKey: PrKey): Promise<ActionResult> {
    throw new Error('not implemented');
  }

  markRead(_tileId: string): Promise<ActionResult> {
    throw new Error('not implemented');
  }

  undo(_undoToken: string | null): Promise<ActionResult> {
    throw new Error('not implemented');
  }

  snooze(_tileId: string, _condition: SnoozeCondition): Promise<ActionResult> {
    throw new Error('not implemented');
  }

  unsnooze(_tileId: string): Promise<ActionResult> {
    throw new Error('not implemented');
  }

  draftAsk(_prKey: PrKey, _person: string, _intent: string): Promise<{ body: string }> {
    throw new Error('not implemented');
  }

  sendComment(_prKey: PrKey, _body: string): Promise<ActionResult> {
    throw new Error('not implemented');
  }

  giveFeedback(_input: FeedbackInput): Promise<ActionResult> {
    throw new Error('not implemented');
  }

  unmuteEvent(_eventId: string): Promise<ActionResult> {
    throw new Error('not implemented');
  }

  chat(_tileId: string, _message: string): Promise<ChatReply> {
    throw new Error('not implemented');
  }

  decideTailoring(_topicId: string, _text: string, _keep: boolean): Promise<ActionResult> {
    throw new Error('not implemented');
  }

  decideTopicProposal(_proposalId: string, _accept: boolean): Promise<ActionResult> {
    throw new Error('not implemented');
  }

  flushPendingWrites(): Promise<void> {
    throw new Error('not implemented');
  }

  close(): Promise<void> {
    throw new Error('not implemented');
  }
}
