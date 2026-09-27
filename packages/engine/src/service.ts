import type {
  ActionResult,
  ChatMessage,
  ChatReply,
  FeedbackInput,
  PrDetail,
  PrKey,
  SnoozeCondition,
  SyncOptions,
  SyncReport,
  TopicDetail,
  TopicListItem,
} from '@code-manager/core';

/**
 * The whole app behind one interface. apps/server exposes it over HTTP and
 * apps/cli calls it directly. Everything is async so a remote implementation
 * could stand in later.
 */
export interface EngineService {
  /**
   * fetch -> store -> classify -> agent digest. Tiles are derived on read.
   * On demand only. A sync while one is running joins the running one.
   */
  sync(options?: SyncOptions): Promise<SyncReport>;

  listTopics(): Promise<TopicListItem[]>;
  getTopic(topicId: string): Promise<TopicDetail | null>;
  getPr(prKey: PrKey): Promise<PrDetail | null>;
  getChat(tileId: string): Promise<ChatMessage[]>;

  /** Immediate and final: GitHub approvals cannot be undone. */
  approve(prKey: PrKey): Promise<ActionResult>;
  /** Marks the tile's events seen and queues the GitHub mark-read behind the undo window. */
  markRead(tileId: string): Promise<ActionResult>;
  /** undoToken null undoes the most recent pending batch. */
  undo(undoToken: string | null): Promise<ActionResult>;
  snooze(tileId: string, condition: SnoozeCondition): Promise<ActionResult>;
  unsnooze(tileId: string): Promise<ActionResult>;

  /** Agent drafts a comment asking `person` something; the user edits it before sendComment. */
  draftAsk(prKey: PrKey, person: string, intent: string): Promise<{ body: string }>;
  sendComment(prKey: PrKey, body: string): Promise<ActionResult>;

  giveFeedback(input: FeedbackInput): Promise<ActionResult>;
  unmuteEvent(eventId: string): Promise<ActionResult>;

  chat(tileId: string, message: string): Promise<ChatReply>;
  /** keep=true stores the text as topic tailoring; false logs it as "just this once". */
  decideTailoring(topicId: string, text: string, keep: boolean): Promise<ActionResult>;
  decideTopicProposal(proposalId: string, accept: boolean): Promise<ActionResult>;

  /** Sends every queued mark-read now. Call on quit: the user meant to clear them. */
  flushPendingWrites(): Promise<void>;
  close(): Promise<void>;
}
