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
  MemoryCorrection,
  MemoryRecheckRequest,
  MemoryRecheckResult,
  MemorySources,
  MemoryTarget,
  NotificationDebugRow,
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
  WorkContextSweepResult,
  WorkContextView,
  WorkThreadForget,
  ViewerView,
} from '@postpile/core';
import type { LivePollOptions, PollCycle } from './live/poll-cycle.ts';

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

  /**
   * One fast-poll cycle: conditional inbox read, and on a change a light
   * incremental sync of the PRs that moved plus ping decisions. Blocked while
   * a full sync or consolidation runs. Throws on rate limits and errors.
   */
  pollOnce(): Promise<PollCycle>;
  /** Starts polling on a timer (the desktop app while it runs). A second call is ignored. */
  startLivePoll(options: LivePollOptions): void;
  stopLivePoll(): void;
  /** For the status footer. `off` when the poll was never started. */
  livePollStatus(): Promise<LivePollStatus>;

  listTopics(): Promise<TopicListItem[]>;
  /** The stored viewer and their teammates, for the sidebar's Mine and Team filters. */
  getViewer(): Promise<ViewerView>;
  /** Carries the topic dossier and what changed since the user last marked the topic seen. */
  getTopic(topicId: string): Promise<TopicDetail | null>;
  /** The title bar's repo menu: repos with PRs, their counts, the scope and the quiet repos. */
  listRepos(): Promise<RepoOverview>;
  /**
   * Narrows topics, queues, tiles and search to these repos; null (or an
   * empty list) shows all. Kept in meta. Local, never a GitHub write.
   */
  setRepoScope(repos: string[] | null): Promise<RepoOverview>;
  /**
   * "Let it go stale": PRs of a quiet repo still sync and feed topic memory,
   * but never make a topic urgent, never ping and stay out of the queue and
   * filter counts. Kept in meta. Local, never a GitHub write.
   */
  setRepoQuiet(repo: string, quiet: boolean): Promise<RepoOverview>;
  /** Search bar: topics, tiles and PRs matching every term of `query`. Empty query, empty result. */
  search(query: string): Promise<SearchResult>;
  /**
   * Debug view of the raw notification stream: the newest `limit` stored
   * threads with where each landed in the app. Read only, never marks anything read.
   */
  debugNotifications(limit: number): Promise<NotificationDebugRow[]>;
  /** The newest `limit` action log entries: every GitHub-affecting action and local mark-reads. */
  actionLog(limit: number): Promise<ActionLogEntry[]>;

  /** The footer lock: are GitHub writes on, is read-only forced by the env, and the pending writes. */
  githubWrites(): Promise<GitHubWritesStatus>;
  /**
   * Flips the lock at runtime and keeps the choice. Refused (ok false) when
   * POSTPILE_READ_ONLY=1 forces read-only. Unlocking sends nothing by
   * itself: pending writes wait for sendPendingWrites.
   */
  setGitHubWrites(enabled: boolean): Promise<GitHubWritesChange>;
  /**
   * "Send N to GitHub": every pending write through the writes door, each
   * result logged. The PRs turn read here as their threads reach GitHub;
   * failures stay pending with the error. Refused while writes are off.
   */
  sendPendingWrites(): Promise<PendingWritesResult>;
  /** "Discard": drops the pending writes. Nothing changes in the app, the tiles stay unread like on GitHub. */
  discardPendingWrites(): Promise<PendingWritesResult>;
  /** Old unread GitHub threads (14 / 30 days), how to show the cleanup, the start-fresh baseline. */
  inboxCleanup(): Promise<InboxCleanupView>;
  /**
   * "Mark everything older than N days read on GitHub": one PUT
   * /notifications through the writes door, logged as mark_all_read_before
   * (origin cleanup). Locked, it becomes one pending write. The inbox is
   * read again afterwards; GitHub may finish it in the background.
   */
  cleanUpInbox(age: CleanupAge): Promise<ActionResult>;
  /** "Leave GitHub alone, start fresh here": a local baseline, nothing written to GitHub. */
  startFresh(): Promise<ActionResult>;
  clearStartFresh(): Promise<ActionResult>;
  /** "Not now": hides the cleanup line and banner for CLEANUP_SNOOZE_DAYS. */
  hideInboxCleanup(): Promise<ActionResult>;
  /** Carries the active facts about the PR, verified at read time. */
  getPr(prKey: PrKey): Promise<PrDetail | null>;
  /** "Who is doing what" and "what changed since T", straight from the fact table. No agent call. */
  listFacts(query: FactQuery): Promise<FactView[]>;
  /** Topic and rule proposals waiting for the user, across all topics. */
  listProposals(): Promise<PendingProposals>;
  getChat(tileId: string): Promise<ChatMessage[]>;

  /** Immediate and final: GitHub approvals cannot be undone. */
  approve(prKey: PrKey): Promise<ActionResult>;
  /**
   * Marks the tile's events seen and queues the GitHub mark-read behind the
   * undo window. With GitHub writes locked nothing changes in the app: after
   * the window it becomes a pending write (the tile shows a marker).
   */
  markRead(tileId: string): Promise<ActionResult>;
  /** "Mark read" on a thread in the notifications debug view. Same queue, undo, lock and log as markRead. */
  markThreadRead(threadId: string): Promise<ActionResult>;
  /** undoToken null undoes the most recent pending mark-read batch. Memory correction tokens undo that correction. */
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
   * "Forget" on a care, or accepting a recheck outcome: drop (kind wrong),
   * holds (confirm) or fix. A fact changes right away; every correction is
   * logged as feedback, so the topic's next dossier update sees it. Local
   * only, never a GitHub write. The result's undo token works with undo()
   * inside UNDO_WINDOW_MS.
   */
  correctMemory(input: MemoryCorrection): Promise<ActionResult>;
  /**
   * "Recheck" on a fact or dossier line: one agent call against the line's
   * sources, the dossier and recent activity. Writes nothing. Capped per day.
   */
  recheckMemory(request: MemoryRecheckRequest): Promise<MemoryRecheckResult>;
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

  /** "What you're working on": the newest digest of local Claude Code notes, the last error, whether a sweep runs. */
  getWorkContext(): Promise<WorkContextView>;
  /**
   * Runs the work context sweep now (Refresh, CLI). Joins a running one.
   * Never throws: a failure keeps the previous version and is reported.
   */
  sweepWorkContext(): Promise<WorkContextSweepResult>;
  /** Forget on a digest thread: logged as feedback, dropped by the next sweep. Undo token for UNDO_WINDOW_MS. */
  forgetWorkThread(input: WorkThreadForget): Promise<ActionResult>;
  /** The daily sweep on a timer (desktop app): at start, then every 30 minutes if due. A second call is ignored. */
  startWorkContextSchedule(): void;
  stopWorkContextSchedule(): void;

  /** Sends every queued mark-read now (locked ones become pending writes). Call on quit: the user meant to clear them. */
  flushPendingWrites(): Promise<void>;
  close(): Promise<void>;
}
