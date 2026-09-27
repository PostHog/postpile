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
  /** Carries the topic dossier and what changed since the user last marked the topic seen. */
  getTopic(topicId: string): Promise<TopicDetail | null>;
  /** Carries the active facts about the PR, verified at read time. */
  getPr(prKey: PrKey): Promise<PrDetail | null>;
  /** "Who is doing what" and "what changed since T", straight from the fact table. No agent call. */
  listFacts(query: FactQuery): Promise<FactView[]>;
  /** Topic and rule proposals waiting for the user, across all topics. */
  listProposals(): Promise<PendingProposals>;
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
  /** Accepting a global rule adds it to every prompt; a topic rule is appended to that topic's tailoring. */
  decideRuleProposal(proposalId: string, accept: boolean): Promise<ActionResult>;
  /** Moves the topic's seen cursor to now, so "changes since seen" starts over. */
  markTopicSeen(topicId: string): Promise<ActionResult>;
  /**
   * "Wrong" on a fact or dossier line, "Forget" on a care. A fact is closed
   * right away; every correction is logged as feedback, so the topic's next
   * dossier update sees it. Local only, never a GitHub write.
   */
  correctMemory(input: MemoryCorrection): Promise<ActionResult>;
  /** "Why?" on a fact or dossier line: its sources and whether it still checks out. Null for an unknown target. */
  getMemorySources(target: MemoryTarget): Promise<MemorySources | null>;

  /** instructions.md with its version history. A hand edit since the newest version is stored as a version first. */
  getInstructions(): Promise<InstructionsView>;
  /** The general chat in "Your instructions", oldest first. */
  getInstructionsChat(): Promise<ChatMessage[]>;
  /** A message in the general chat. Comes back with a proposal when it asks for a change. Nothing is written to the file. */
  instructionsChat(message: string): Promise<InstructionsChatReply>;
  /** "Keep for all topics" on a lasting point: the user's chat message asked as an instructions change. */
  proposeInstructions(sourceChatMessageId: number): Promise<InstructionsProposalReply>;
  /**
   * Writes an accepted proposal to instructions.md and stores the version.
   * Refuses to overwrite a hand edit made after the proposal: that edit is
   * kept and the change comes back rebased for another decision.
   */
  saveInstructions(decision: InstructionsDecision): Promise<InstructionsSaveResult>;

  /**
   * The sleep-time job: proposes topic merges, splits and renames, retires
   * finished topics, folds duplicate facts, and proposes standing rules from
   * repeated feedback. On demand or when the host is idle after a sync.
   * A consolidation while one is running joins the running one.
   */
  consolidate(options?: ConsolidateOptions): Promise<ConsolidationReport>;

  /** Sends every queued mark-read now. Call on quit: the user meant to clear them. */
  flushPendingWrites(): Promise<void>;
  close(): Promise<void>;
}
