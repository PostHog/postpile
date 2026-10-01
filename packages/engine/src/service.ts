import type {
  ActionLogEntry,
  ActionResult,
  AgentActionFrom,
  ApprovePrRequest,
  BatchApproveResult,
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
  CleanupAge,
  InboxCleanupView,
  PendingWritesResult,
  InstructionsChatReply,
  InstructionsDecision,
  InstructionsProposalReply,
  InstructionsSaveResult,
  InstructionsView,
  ListScope,
  LivePollStatus,
  MacNotification,
  McpConnectFrom,
  McpConnectionView,
  SyncProgress,
  MemoryCorrection,
  MemoryRecheckRequest,
  MemoryRecheckResult,
  MemorySources,
  MemoryTarget,
  NotificationDebugRow,
  GlanceLookResult,
  OpenedReadResult,
  QuietReadView,
  PendingProposals,
  PingTarget,
  PrDetail,
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
  TeamRolesView,
  ToolsView,
  TopicDetail,
  TopicListItem,
  WorkContextSweepResult,
  WorkContextView,
  WorkThreadForget,
  ViewerView,
  BoardShapeEvent,
} from '@postpile/core';
import type { AutoSyncOptions } from './auto-sync.ts';
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
  /** The report of the last finished sync, errors and timing included (meta last_sync_report). Null before the first one. */
  lastSyncReport(): Promise<SyncReport | null>;
  /** The version of the app that last opened the database for writing (meta app_version); null before one recorded it, and on sample data. */
  recordedAppVersion(): Promise<string | null>;
  /** The schema version the open database has right now (MAX(version) of schema_migrations); null on sample data. Cheap, and read on the connection already open. */
  databaseSchemaVersion(): Promise<number | null>;
  /** The sync in flight (phases, agent calls done and planned so far); null when none runs. */
  syncProgress(): Promise<SyncProgress | null>;

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
  /**
   * A background full sync every `minutes` while the host runs (desktop app),
   * capped like "Sync now". Counts from the end of the last sync, skipped
   * while one runs. 0 or less keeps it off. A second call is ignored.
   */
  startAutoSync(options: AutoSyncOptions): void;
  stopAutoSync(): void;
  /**
   * Retry on a glance that failed: clears the PR's glance gap and runs a
   * glance catch-up for its topic now (or queues the one follow-up when a run
   * is going). Local: agent calls only, never a GitHub write.
   */
  retryGlance(prKey: PrKey): Promise<ActionResult>;
  /**
   * The PR stayed open in the detail pane with a stale glance (DESIGN.md
   * "Glance refresh on look"): checks the input hash again and, when the
   * glance is still behind, runs a glance-only catch-up for that PR from
   * the topic's dossier as it is. Folded into a run for its topic that is
   * going or queued; counts against the daily catch-up cap; nothing over it
   * or with catch-up off. Local: agent calls only, never a GitHub write.
   */
  refreshGlanceOnLook(prKey: PrKey): Promise<GlanceLookResult>;
  /**
   * The window got focus: one poll cycle now, unless one started less than
   * 15s ago, none ran yet, or the poll is off or paused by the quota. prKeys are the PRs the
   * user opened on github.com from the app lately: that cycle (or the next,
   * when debounced) also looks each up directly (a direct fetch for PRs
   * without a thread), so their tiles follow GitHub right away. Skipped while
   * a full sync or consolidation runs.
   */
  refreshOnFocus(prKeys: PrKey[]): Promise<void>;
  /**
   * refresh_from_github from an outside agent (DESIGN.md
   * "refresh_from_github"): re-reads one PR, or a topic's open PRs (at most
   * 10), from GitHub now, in one poll cycle with them in focus; a running
   * full sync is joined instead. Fresh PRs are skipped; the hourly cap, one
   * at a time and the quota gate apply across all agents. Logged as
   * agent_refresh. GitHub reads only, never a write.
   */
  refreshNow(target: AgentRefreshTarget, options: AgentRefreshOptions): Promise<AgentRefreshResult>;
  /**
   * propose_topic_change from an outside agent (DESIGN.md
   * "propose_topic_change"): checks the change against the topics now, and
   * files it as a pending topic proposal (source agent, with the client
   * name) unless it is a dry run. Answers with a preview of what accepting
   * would do, stacks included. Never applies it.
   */
  proposeTopicChange(change: TopicChangeRequest, options: { client: string }): Promise<TopicChangeResult>;
  /**
   * Answers agent requests from MCP processes (DESIGN.md "Agent requests"):
   * watches `<data folder>/agent-requests` while the desktop app runs. A
   * second call is ignored; a no-op without a data folder (sample data,
   * read-only access).
   */
  startAgentRequests(): void;
  stopAgentRequests(): void;

  /** The sidebar's topics, in the chosen repo unless `scope.allRepos`. */
  listTopics(scope?: ListScope): Promise<TopicListItem[]>;
  /**
   * The PRs held by an unread tile, in every repo. The desktop app clears a
   * ping from Notification Center once its PR is not in this list anymore.
   */
  unreadPrKeys(): Promise<PrKey[]>;
  /**
   * Where a click on a Mac notification goes, looked up on the board as it
   * is at the click (`pingClickTarget`): tiles and topics move after a ping.
   * Null: its PRs and its topic are gone, the app only comes to the front.
   */
  pingClickTarget(notification: Pick<MacNotification, 'target' | 'prKeys'>): Promise<PingTarget | null>;
  /** Runs `listener` after every full sync that ran to the end (the moment sync_completed is sent); one listener, a second call replaces it. */
  onSyncCompleted(listener: () => void): void;
  /** The daily board snapshot's events over the topics the sidebar lists (all repos), counts only. */
  boardShape(): Promise<BoardShapeEvent[]>;
  /** Topics retired in the last 30 days, newest first, for the sidebar's Finished drawer. getTopic opens any of them. */
  listFinishedTopics(): Promise<FinishedTopic[]>;
  /** The stored viewer and their teammates, for the sidebar's Mine and Team filters. */
  getViewer(): Promise<ViewerView>;
  /** The viewer's teams with their roles (home or routing only) and why. */
  getTeamRoles(): Promise<TeamRolesView>;
  /**
   * The user flips one team's role. It sticks over later classifications.
   * The stored viewer follows right away: its home teams, and the members
   * of a new home team (a GitHub read). Local, never a GitHub write.
   */
  setTeamRole(team: string, role: TeamRole): Promise<TeamRolesView>;
  /** Carries the topic dossier and what changed since the user last marked the topic seen. */
  getTopic(topicId: string): Promise<TopicDetail | null>;
  /** The title bar's repo menu: repos with topic and PR counts, the chosen repo and the quiet repos. */
  listRepos(): Promise<RepoOverview>;
  /**
   * "All repos" (null) or one repo. It only selects topics: the sidebar,
   * queue counts and search keep the topics with a PR in that repo, and an
   * opened topic still shows all its tiles, labelling the ones from other
   * repos. Kept in meta. Local, never a GitHub write.
   */
  setRepoScope(repo: string | null): Promise<RepoOverview>;
  /**
   * "Let it go stale": PRs of a quiet repo still sync and feed topic memory,
   * but never make a topic urgent, never ping and stay out of the queue and
   * filter counts. Kept in meta. Local, never a GitHub write.
   */
  setRepoQuiet(repo: string, quiet: boolean): Promise<RepoOverview>;
  /** Search bar: topics, tiles and PRs matching every term of `query`. Empty query, empty result. */
  search(query: string, scope?: ListScope): Promise<SearchResult>;
  /**
   * Debug view of the raw notification stream: the newest `limit` stored
   * threads with where each landed in the app. Read only, never marks anything read.
   */
  debugNotifications(limit: number): Promise<NotificationDebugRow[]>;
  /**
   * "Handled quietly": PR threads PostPile marked read on GitHub by itself in
   * the last HANDLED_QUIETLY_DAYS days (only bot activity since the user's
   * last read, the user acted after every unread event, or opened the PR in
   * PostPile), each with its reason, newest first, from the action log.
   */
  handledQuietly(): Promise<QuietReadView[]>;
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
  /** Old unread GitHub threads (14 / 30 days) and how to show the cleanup. */
  inboxCleanup(): Promise<InboxCleanupView>;
  /**
   * "Mark everything older than N days read on GitHub": one PUT
   * /notifications through the writes door, logged as mark_all_read_before
   * (origin cleanup). Locked, it becomes one pending write. The inbox is
   * read again afterwards; GitHub may finish it in the background.
   */
  cleanUpInbox(age: CleanupAge): Promise<ActionResult>;
  /** "Not now": hides the cleanup line and banner for CLEANUP_SNOOZE_DAYS. */
  hideInboxCleanup(): Promise<ActionResult>;
  /** Carries the active facts about the PR, verified at read time. */
  getPr(prKey: PrKey): Promise<PrDetail | null>;
  /** "Who is doing what" and "what changed since T", straight from the fact table. No agent call. */
  listFacts(query: FactQuery): Promise<FactView[]>;
  /** Topic and rule proposals waiting for the user, across all topics. */
  listProposals(): Promise<PendingProposals>;
  getChat(tileId: string): Promise<ChatMessage[]>;

  /**
   * Immediate and final: GitHub approvals cannot be undone. `headOid` is the
   * head commit the user looked at; a different stored head refuses the
   * approval without calling GitHub.
   */
  approve(prKey: PrKey, headOid: string): Promise<ActionResult>;
  /**
   * Agent-assisted Approve (a tile's or the topic's ✨ Approve, DESIGN.md
   * "Agent-assisted actions"): each PR through `approve` with its head guard,
   * in the order given, reported per PR. Final, no undo.
   */
  approveMany(prs: ApprovePrRequest[], from: AgentActionFrom): Promise<BatchApproveResult>;
  /**
   * "Remove <team>": removes the review request of one of the viewer's teams
   * (`team` as GitHub lists it, "acme/team-devex"), unsubscribes from the
   * PR's thread and marks the PR done here. Final, no undo; refused while
   * GitHub writes are locked.
   */
  removeTeamRequest(prKey: PrKey, team: string): Promise<ActionResult>;
  /**
   * Marks the tile's events seen and queues the GitHub mark-read behind the
   * undo window. With GitHub writes locked nothing changes in the app: after
   * the window it becomes a pending write (the tile shows a marker).
   */
  markRead(tileId: string): Promise<ActionResult>;
  /**
   * Mark read / Mark done in the detail pane: only `prKey` of the tile. Its
   * events seen, handled when the tile tracks it, its GitHub thread through
   * the same queue, lock and undo as markRead; undo brings back that PR only.
   */
  markPrRead(tileId: string, prKey: PrKey): Promise<ActionResult>;
  /**
   * Agent-assisted Mark read (a tile's ✨ Mark read, the topic's "Mark N
   * read"): the tiles' reads as one batch through the same queue, lock and
   * pending writes as markRead, so one undo token brings all of them back.
   */
  markTilesRead(tileIds: string[], from: AgentActionFrom): Promise<ActionResult>;
  /** "Mark read" on a thread in the notifications debug view. Same queue, undo, lock and log as markRead. */
  markThreadRead(threadId: string): Promise<ActionResult>;
  /**
   * The PR stayed through the dwell in the detail pane: when a mark-read of
   * that PR would leave it done and no tile holding it is snoozed, only while
   * writes are unlocked, marks it read like the pane's Mark read (origin
   * detail, its own batch and undo token): events seen, handledAt, and an
   * unread GitHub thread queued for after the undo window. Nothing happens
   * otherwise, not even a pending write.
   */
  markOpenedRead(prKey: PrKey): Promise<OpenedReadResult>;
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
  /** "Archive now" on a topic with nothing left; refused while anything is open or unread. */
  archiveTopic(topicId: string): Promise<ActionResult>;
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
  /** Saves the sweep's skip list to the user's config.json; read again on every sweep. */
  setSweepSkip(patterns: string[]): Promise<ActionResult>;
  /** The daily sweep on a timer (desktop app): at start, then every 30 minutes if due. A second call is ignored. */
  startWorkContextSchedule(): void;
  stopWorkContextSchedule(): void;

  /**
   * gh and claude: found, logged in, usable, with the exact fix commands.
   * Checked on the first ask, then again only while something is wrong, on
   * a backoff (1 minute doubling to 30). Never runs a check when none is due.
   */
  tools(): Promise<ToolsView>;
  /** "Check again": checks gh and claude now, whatever the backoff says. */
  checkTools(): Promise<ToolsView>;

  /**
   * Whether Claude Code has PostPile's MCP server (`claude mcp get postpile`
   * in the app's own folder, at most every few minutes), the commands to add
   * it by hand, and the footer's "Not now". Runs nothing in a dev build or
   * while claude is missing or logged out.
   */
  mcpConnection(): Promise<McpConnectionView>;
  /**
   * "Add to Claude Code": `claude mcp add --scope user postpile -- <launcher>`.
   * Only from a click, only in the installed app. Local: it changes Claude
   * Code's config, never GitHub.
   */
  connectMcp(from: McpConnectFrom): Promise<ActionResult>;
  /** "Not now" on the footer's offer: kept in meta, the footer item stays away. */
  hideMcpConnect(): Promise<ActionResult>;

  /** Setup flow: whether it shows on start (first run: no instructions, never accepted or skipped) and the stored flag. */
  setupStatus(): Promise<SetupStatus>;
  /** Setup step 1: gh installed and logged in, notifications readable, claude found. Read only, run fresh each time. */
  setupChecks(): Promise<SetupChecksView>;
  /**
   * Setup step 2: starts the sweep job (viewer and teams, 30 days of PRs,
   * CODEOWNERS, the digest, one setup_draft call) and returns at once; a
   * start while one runs joins it. Poll setupSweep for the progress lines.
   */
  startSetupSweep(): Promise<SetupSweepView>;
  /** The running or last sweep with its draft; null before the first one in this process. */
  setupSweep(): Promise<SetupSweepView | null>;
  /** "Tell the agent what's off": one setup_refine call over the sweep's material. Writes nothing. */
  refineSetup(request: SetupRefineRequest): Promise<SetupRefineResult>;
  /** Setup's fit check on the Accept step: one setup_fit call over the user's text. Writes nothing. */
  checkSetupFit(request: SetupFitRequest): Promise<SetupFitResult>;
  /**
   * Accept: writes instructions.md as a new version (origin setup), sets the
   * quiet repos and the repo scope, stores the done flag. Refused when the
   * file changed since the draft was reviewed. Local only; the caller syncs next.
   */
  acceptSetup(request: SetupAcceptRequest): Promise<SetupAcceptResult>;
  /** "Skip for now": stores the skipped flag, so the flow no longer shows on start. */
  skipSetup(): Promise<ActionResult>;

  /** Sends every queued mark-read now (locked ones become pending writes). Call on quit: the user meant to clear them. */
  flushPendingWrites(): Promise<void>;
  close(): Promise<void>;
}
