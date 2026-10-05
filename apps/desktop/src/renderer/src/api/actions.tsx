// The one place the renderer changes anything. Components call useActions();
// nothing else may send a POST or DELETE to the API. Actions that end up as a
// GitHub write go through the guard in lib/guard.ts first.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import type {
  ActionResult,
  AgentActionFrom,
  AppConfig,
  BatchApproveResult,
  ChatReply,
  CleanupRequest,
  SafeCleanupRequest,
  FeedbackInput,
  GitHubWritesChange,
  GitHubWritesStatus,
  GlanceLookResult,
  InstructionsChatReply,
  InstructionsDecision,
  InstructionsProposal,
  InstructionsProposalReply,
  InstructionsSaveResult,
  InterruptionsMode,
  InterruptionsView,
  McpConnectFrom,
  MemoryCorrection,
  MemoryRecheckRequest,
  MemoryRecheckResult,
  OpenedReadResult,
  PendingWritesResult,
  PrApproveResult,
  PrDetail,
  PrKey,
  RepoOverview,
  ReviewNoteKind,
  SetupAcceptRequest,
  SetupAcceptResult,
  SetupFitRequest,
  SetupFitResult,
  SetupRefineRequest,
  SetupRefineResult,
  SetupSweepView,
  SkippedTile,
  SnoozeCondition,
  SyncReport,
  TeachLessonResult,
  TeamRole,
  TeamRolesView,
  TeamRoleView,
  TileAfterRead,
  TileView,
  ToolsView,
  TopicDetail,
  WorkContextSweepResult,
  WorkThreadForget,
} from '@postpile/core';
import { capNote } from '../lib/agent-stats.ts';
import { writeBlockedReason, type GithubWrite } from '../lib/guard.ts';
import { approvedMessage, batchMarkReadMessage } from '../lib/agent-actions.ts';
import { markReadNotice } from '../lib/mark-read.ts';
import { approvedDetail, markedReadPr, markedReadTile, snoozedTile, withApprovedPrs, withTile, withTiles } from '../lib/optimistic.ts';
import { newerReport } from '../lib/sync-report.ts';
import { teamRoleNotice } from '../lib/team-roles.ts';
import { UNDO_WINDOW_MS } from '../lib/undo-window.ts';
import { doneText } from '../lib/cleanup.ts';
import { useInboxCleanup } from './cleanup.ts';
import { useLiveStatus } from './live.ts';
import { useAppConfig } from './config.ts';
import { useLastSyncReport } from './sync.ts';
import { useGitHubWrites } from './writes.ts';
import { prPath, request, tilePath, tilePrPath } from './client.ts';
import { queryKeys } from './keys.ts';
import { sendTelemetry } from './telemetry.ts';

const NOTICE_MS = 6000;
// Matches the engine's memory correction undo tokens.
const MEMORY_UNDO_PREFIX = 'memory:';
const PROBLEM_NOTICE_MS = 12000;
/** Busy keys of the inbox cleanup's actions, one each (see withBusy). */
export const CLEANUP_BUSY = {
  clear: 'cleanup:clear',
  clearSafe: 'cleanup:clear-safe',
  start: 'cleanup:start-as-usual',
} as const;
// Room for the engine to send or park a batch after its window ends.
const UNDO_SETTLE_MS = 400;

export type NoticeTone = 'ok' | 'error' | 'blocked';

export interface Notice {
  id: number;
  tone: NoticeTone;
  message: string;
  undoToken: string | null;
  /** The toast offers "Snooze" for this tile: a mark-read left it your move. */
  snoozeTileId: string | null;
  /** The toast offers "Show": the notifications view, where each thread's last action is listed (the inbox cleanup's done toast). */
  showActionLog?: boolean;
}

/** Reshapes the notice of a successful or failed action, e.g. the mark-read that leaves a tile your move. */
type NoticeShape = (result: ActionResult) => { message: string; snoozeTileId: string | null };

/** Changes the cache before the server answers (lib/optimistic.ts) and returns how to put the old data back. */
type Optimistic = () => Promise<() => void>;

interface PendingUndo {
  token: string;
  until: number;
}

export interface Actions {
  config: AppConfig | undefined;
  /** The footer lock. Undefined until loaded; GitHub writes stay blocked until then. */
  writes: GitHubWritesStatus | undefined;
  notice: Notice | null;
  dismissNotice(): void;
  /** A full sync runs: this window's "Sync now", or one the engine started (start sync elsewhere, the hourly auto sync). */
  syncing: boolean;
  /**
   * Counts the user's explicit topic moves (driver picks). The sidebar holds
   * the open topic's row while a tile stays selected; a move re-takes that
   * place, so the picked topic goes to its new section at once.
   */
  topicMoves: number;
  lastSync: SyncReport | null;
  /** Mark-reads still inside their undo window, as far as this window knows. */
  pendingMarkReads: number;
  isBusy(key: string): boolean;
  blockedReason(action: GithubWrite): string | null;

  sync(): Promise<void>;
  /** "Check again" on a missing-tool note: checks gh and claude now. Local, runs nothing on GitHub. */
  checkTools(): Promise<void>;
  /** The footer lock. Turning on is confirmed in the footer first; the server refuses it when the env forces read-only. Returns whether it switched. */
  setGitHubWrites(enabled: boolean): Promise<boolean>;
  /** "Send N to GitHub": the mark-reads made while locked. Refused by the server while writes are off. */
  sendPendingWrites(): Promise<void>;
  /** "Discard": drops the pending writes; the tiles stay unread, like on GitHub. */
  discardPendingWrites(): Promise<void>;
  /** "Mark read" on a thread in the notifications debug view. Same queue, undo and lock as a tile. */
  markThreadRead(threadId: string): Promise<void>;
  /**
   * The PR stayed through the dwell in the detail pane: the server marks it
   * read when nothing is asked of the user, like the pane's Mark read. No
   * toast: the mark button says it and offers the Undo (`undo` with the
   * result's token). Never sent while GitHub writes are locked; null when it
   * was not sent or failed.
   */
  markOpenedRead(prKey: PrKey): Promise<OpenedReadResult | null>;
  /**
   * `headOid`: the head commit on screen; the server refuses the approval when
   * the PR moved past it. `body`: the note from "Approve with comment", empty for none.
   * Returns true when it went out.
   */
  approve(prKey: PrKey, headOid: string, body?: string): Promise<boolean>;
  /**
   * "Comment review": a review with event COMMENT on `headOid`, refused like
   * approve when the PR moved past it. Final, blocked while locked. Returns
   * true when it went out.
   */
  commentReview(prKey: PrKey, headOid: string, body: string): Promise<boolean>;
  /**
   * The ✨ Approve of a tile or the topic, after the confirm list: one call for
   * the covered PRs. Optimistic like the pane's approve, never an Undo.
   * `busyKey` is the button's own (`isBusy`).
   */
  approveAgent(input: { busyKey: string; prs: { prKey: PrKey; headOid: string }[]; from: AgentActionFrom }): Promise<void>;
  /** "Remove <team>": removes the team's review request, unsubscribes and marks the PR done. Final, no undo; blocked while locked. */
  removeTeamRequest(prKey: PrKey, team: string): Promise<void>;
  /** Retry on a failed glance: a catch-up run for the PR's topic. Agent calls only, not a GitHub write. */
  retryGlance(prKey: PrKey): Promise<void>;
  /**
   * The PR stayed open with a stale glance (`useGlanceLook`): the server
   * writes a new one when it is still behind and a refresh can run. Quiet
   * (no toast, no busy key). Agent calls only, not a GitHub write.
   */
  refreshGlanceOnLook(prKey: PrKey): Promise<void>;
  /** `afterRead`: what the tile would be after it (`TileView.afterRead`), so the toast can say it is still your move. */
  markRead(tileId: string, afterRead?: TileAfterRead): Promise<void>;
  /** The topic's ✨ "Mark N read": the covered tiles as one batch with one Undo. `skipped` only words the toast. */
  markTilesRead(input: { busyKey: string; tileIds: string[]; skipped: SkippedTile[] }): Promise<void>;
  /**
   * The detail pane's Mark read / Mark done on a stack or set: only `prKey`.
   * Same queue, lock and undo as markRead, undo brings back that PR only.
   * `afterRead` is the PR's (`PrSummary.afterRead`); the toast never offers
   * Snooze here, since snoozing is for the whole tile.
   */
  markPrRead(tileId: string, prKey: PrKey, afterRead: TileAfterRead): Promise<void>;
  snooze(tileId: string, condition: SnoozeCondition): Promise<void>;
  unsnooze(tileId: string): Promise<void>;
  undo(undoToken: string): Promise<void>;
  feedback(input: FeedbackInput): Promise<void>;
  unmute(eventId: string): Promise<void>;
  decideTailoring(topicId: string, text: string, keep: boolean): Promise<void>;
  decideProposal(proposalId: string, accept: boolean): Promise<void>;
  decideRuleProposal(proposalId: string, accept: boolean): Promise<void>;
  /** "Forget", or accepting a recheck outcome. Local memory, not a GitHub write. The toast offers Undo. */
  correctMemory(input: MemoryCorrection): Promise<boolean>;
  /** "Recheck": one agent call, nothing written. Null when the request itself failed. */
  recheckMemory(request: MemoryRecheckRequest): Promise<MemoryRecheckResult | null>;
  /** The repo menu's choice: one repo, or null for all. Local, quiet (no toast). */
  setRepoScope(repo: string | null): Promise<void>;
  /** "Let it go stale" on a repo, or waking it up again. Local, not a GitHub write. */
  setRepoQuiet(repo: string, quiet: boolean): Promise<void>;
  /** "Make routing only" / "Make home team" on one of your teams. Local and sticky, not a GitHub write. */
  setTeamRole(team: TeamRoleView, role: TeamRole): Promise<void>;
  /**
   * "Clear N" in the inbox cleanup dialog. A GitHub write: it runs in the
   * background on the server, and with the lock closed it becomes one
   * pending write. Returns whether the server took it.
   */
  clearInbox(request: CleanupRequest): Promise<boolean>;
  /**
   * The sidebar's "N of them look safe · Clear": only the merged PRs whose
   * current glance says LOOKS_SAFE or NOT_YOURS, right away (no dialog). The
   * same GitHub write as clearInbox: background run, one pending write while
   * locked. Returns whether the server took it.
   */
  clearSafeMerged(request: SafeCleanupRequest): Promise<boolean>;
  /** "Start as usual" (or Esc) on the start dialog: the held sync goes on. Local, no toast. */
  startAsUsual(): Promise<boolean>;
  /**
   * "Add to Claude Code": the server runs `claude mcp add` (installed app
   * only). Local, not a GitHub write; fire it only from a click. Returns
   * whether Claude Code has the server afterwards.
   */
  connectMcp(from: McpConnectFrom): Promise<boolean>;
  /** "Not now" on the footer's MCP offer. Local, kept by the server. */
  hideMcpConnect(): Promise<boolean>;
  /**
   * The sidebar's Interruptions menu: when PostPile may show a Mac
   * notification. Local, quiet (no toast); the row shows the new mode right
   * away and goes back on a failure.
   */
  setInterruptions(mode: InterruptionsMode): Promise<void>;
  /** "Send a test notification" (desktop app only, over the preload). Says in a toast what happened. */
  sendTestNotification(): Promise<void>;
  /** Quiet: no toast. Called when the user leaves a topic. */
  markTopicSeen(topicId: string): Promise<void>;
  /** "Archive now" on a topic with nothing left. Local, not a GitHub write. */
  archiveTopic(topicId: string): Promise<void>;
  /** The header's driver menu: a choice's value, null for Reset to automatic. Local, not a GitHub write. */
  setTopicDriver(topicId: string, driver: string | null): Promise<void>;
  /** Returns the agent's draft, or null when drafting failed. */
  draftAsk(prKey: PrKey, person: string, intent: string): Promise<string | null>;
  /**
   * The agent's draft for "Approve with a note" or "Comment review", or null
   * when drafting failed. `gist`: the user's words to write it from ("Rewrite
   * with the agent"); empty drafts from the PR alone.
   */
  draftReviewNote(prKey: PrKey, kind: ReviewNoteKind, gist?: string): Promise<string | null>;
  /** The agent's draft of a reply to one comment, from its thread and `gist` (empty: from the thread alone). Null when drafting failed. */
  draftReply(prKey: PrKey, commentId: string, gist: string): Promise<string | null>;
  /** Returns true when the comment went out. */
  sendComment(prKey: PrKey, body: string): Promise<boolean>;
  /**
   * Reply to one human comment: in its thread for a code comment, else a new
   * PR comment that quotes it. Final, blocked while locked. True when it went out.
   */
  replyToComment(prKey: PrKey, commentId: string, body: string): Promise<boolean>;
  /** A thumbs up on a comment or review. Blocked while locked. True when it went out. */
  react(prKey: PrKey, commentId: string): Promise<boolean>;
  /** A message in the topic's agent chat ("Ask the agent"). Local, not a GitHub write. */
  topicChat(topicId: string, message: string): Promise<ChatReply | null>;
  /** A message in the "Your instructions" chat. Local, not a GitHub write. */
  instructionsChat(message: string): Promise<InstructionsChatReply | null>;
  /** "Keep for all topics": the user's chat message asked as an instructions change. Null when it changes nothing. */
  proposeInstructions(sourceChatMessageId: number): Promise<InstructionsProposal | null>;
  /** Accepts a proposal: writes instructions.md. Local, not a GitHub write. */
  saveInstructions(decision: InstructionsDecision): Promise<InstructionsSaveResult | null>;
  /**
   * "Teach future assessments": one agent call that turns the user's note
   * into a lesson, which then waits in the topic like one from a review.
   * Local, not a GitHub write. Null when the request itself failed (toast).
   */
  teachLesson(prKey: PrKey, note: string): Promise<TeachLessonResult | null>;
  /** "Remember in this topic": the lesson's line joins the topic's tailoring. Local. Returns whether it was kept. */
  keepLessonForTopic(lessonId: number): Promise<boolean>;
  /** "Dismiss" on a lesson: not offered again. Local. */
  dismissLesson(lessonId: number): Promise<boolean>;
  /**
   * "Use across topics…": one agent call, nothing written. The proposal goes
   * through saveInstructions like any other; a reply without one is shown
   * where the user clicked, not as a toast. Null when the request failed.
   */
  proposeInstructionsFromLesson(lessonId: number): Promise<InstructionsProposalReply | null>;
  /** "Refresh" on "What you're working on": one agent call over local notes, can take a minute. */
  refreshWorkContext(): Promise<void>;
  /** "Forget" on a digest thread. Local only; the toast offers Undo. */
  forgetWorkThread(input: WorkThreadForget): Promise<boolean>;
  /** Saves the sweep's skip list to the user's config.json. */
  saveSweepSkip(patterns: string[]): Promise<boolean>;
  /** Setup step 2: starts the sweep job (reads GitHub, one agent call); useSetupSweep polls it. */
  startSetupSweep(): Promise<void>;
  /** "Tell the agent what's off": one agent call, nothing written. Null when the request itself failed. */
  refineSetup(body: SetupRefineRequest): Promise<SetupRefineResult | null>;
  /** Setup's fit check: one agent call over the text about to be accepted, nothing written. A failed request comes back as ok: false. */
  checkSetupFit(body: SetupFitRequest): Promise<SetupFitResult>;
  /** Setup's Accept: writes instructions.md as a new version, quiet repos, scope and the done flag. Local, not a GitHub write. */
  acceptSetup(body: SetupAcceptRequest): Promise<SetupAcceptResult | null>;
  /** "Skip for now": stores the skipped flag. Local. */
  skipSetup(): Promise<boolean>;
}

const ActionsContext = createContext<Actions | null>(null);

export function useActions(): Actions {
  const actions = useContext(ActionsContext);
  if (!actions) {
    throw new Error('useActions needs <ActionsProvider>');
  }
  return actions;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function ActionsProvider(props: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const config = useAppConfig().data;
  const writes = useGitHubWrites().data;
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState<string[]>([]);
  const [pendingUndos, setPendingUndos] = useState<PendingUndo[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [topicMoves, setTopicMoves] = useState(0);
  const [lastSync, setLastSync] = useState<SyncReport | null>(null);
  // Before this window's first sync: the one the engine stored, e.g. a start sync that failed.
  const storedLastSync = useLastSyncReport().data ?? null;
  // Syncs this window did not start (the hourly auto sync) show in the title bar the same way.
  const live = useLiveStatus().data;
  const backgroundSync = live?.syncRunning ?? false;
  const liveLoaded = live !== undefined;
  const keptUnread = live?.keptUnread ?? null;
  // The newest kept-unread notice this window has seen; undefined until the live status first loads.
  const seenKeptUnread = useRef<number | null | undefined>(undefined);
  const cleanup = useInboxCleanup().data;
  const cleanupRun = cleanup?.lastRun ?? null;
  // The newest inbox cleanup run this window has seen end; undefined until the view first loads.
  const seenCleanupRun = useRef<string | null | undefined>(undefined);

  // Notices fade on their own; problems stay a little longer.
  useEffect(() => {
    if (!notice) {
      return;
    }
    const timer = setTimeout(() => setNotice(null), notice.tone === 'ok' ? NOTICE_MS : PROBLEM_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  // A Mark read GitHub skipped for newer activity that stayed unread after the engine's refresh:
  // the toast says what is new. One from before this window opened is not shown.
  useEffect(() => {
    if (!liveLoaded) {
      return;
    }
    if (seenKeptUnread.current !== undefined && keptUnread !== null && keptUnread.id !== seenKeptUnread.current) {
      show('error', keptUnread.message);
    }
    seenKeptUnread.current = keptUnread?.id ?? null;
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- show is new every render; only a new notice matters
  }, [liveLoaded, keptUnread?.id]);

  // An inbox cleanup ran to its end in the background: the done toast, with "Show". One that ended before this window opened is not shown.
  useEffect(() => {
    if (cleanup === undefined) {
      return;
    }
    if (seenCleanupRun.current !== undefined && cleanupRun !== null && cleanupRun.id !== seenCleanupRun.current) {
      setNotice({ id: Date.now(), tone: cleanupRun.marked > 0 ? 'ok' : 'error', message: `✓ ${doneText(cleanupRun)}`, undoToken: null, snoozeTileId: null, showActionLog: true });
      void refreshAll();
    }
    seenCleanupRun.current = cleanupRun?.id ?? null;
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- refreshAll is new every render; only a new run matters
  }, [cleanup === undefined, cleanupRun?.id]);

  // Drop undo entries once the engine has sent them to GitHub (or, while
  // locked, turned them into pending writes), then refetch so tiles and the
  // footer lock show what happened.
  useEffect(() => {
    const first = pendingUndos[0];
    if (!first) {
      return;
    }
    const timer = setTimeout(
      () => {
        setPendingUndos((current) => current.filter((entry) => entry.until > Date.now()));
        void refreshAll();
      },
      Math.max(first.until - Date.now(), 0) + UNDO_SETTLE_MS,
    );
    return () => clearTimeout(timer);
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- refreshAll is new every render; the timer must not restart for it
  }, [pendingUndos]);

  function show(tone: NoticeTone, message: string, undoToken: string | null = null, snoozeTileId: string | null = null): void {
    setNotice({ id: Date.now(), tone, message, undoToken, snoozeTileId });
  }

  function refreshAll(): Promise<void> {
    // Everything but the config, which is fixed for the process.
    return queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] !== queryKeys.config[0] });
  }

  /** Blocked GitHub writes show why and never reach the API. */
  function isBlocked(write: GithubWrite | null): boolean {
    const reason = write ? writeBlockedReason(write, writes) : null;
    if (reason) {
      show('blocked', reason);
    }
    return reason !== null;
  }

  async function withBusy<T>(busyKey: string, task: () => Promise<T>): Promise<T> {
    setBusy((current) => [...current, busyKey]);
    try {
      return await task();
    } finally {
      setBusy((current) => current.filter((key) => key !== busyKey));
    }
  }

  /**
   * Shows `change` on every cached copy of `queryKey` right away. A refetch
   * in flight is cancelled first so it cannot paint the old data over it.
   * Returns the rollback: the copies as they were.
   */
  async function changeCache<T>(queryKey: QueryKey, change: (data: T) => T): Promise<() => void> {
    await queryClient.cancelQueries({ queryKey });
    const snapshot = queryClient.getQueriesData<T>({ queryKey });
    queryClient.setQueriesData<T>({ queryKey }, (data) => (data === undefined ? data : change(data)));
    return () => snapshot.forEach(([key, data]) => queryClient.setQueryData(key, data));
  }

  /** The tile as `change` makes it, in whichever cached topic holds it. */
  function changeTile(tileId: string, change: (view: TileView) => TileView): Promise<() => void> {
    return changeCache<TopicDetail>(['topic'], (detail) => withTile(detail, tileId, change));
  }

  /**
   * With `optimistic`, the screen shows the result on click: the cache
   * changes before the request, a failure puts the old data back (and says
   * why in the toast), and the button stays busy until the refetch brought
   * the server's answer, so it never offers the old action again meanwhile.
   * Blocked writes change nothing.
   */
  async function run(
    busyKey: string,
    write: GithubWrite | null,
    task: () => Promise<ActionResult>,
    shape: NoticeShape | null = null,
    optimistic: Optimistic | null = null,
  ): Promise<boolean> {
    if (isBlocked(write)) {
      return false;
    }
    return withBusy(busyKey, async () => {
      let rollback: (() => void) | null = null;
      try {
        rollback = optimistic ? await optimistic() : null;
        const result = await task();
        if (!result.ok) {
          rollback?.();
        }
        const shaped = shape ? shape(result) : { message: result.message, snoozeTileId: null };
        show(result.ok ? 'ok' : 'error', shaped.message, result.undoToken, shaped.snoozeTileId);
        // A settle token has no Undo in the toast, but its mark-read is watched the same way: refetch once it settled.
        const watched = result.undoToken ?? result.settleToken ?? null;
        if (watched) {
          const entry = { token: watched, until: Date.now() + UNDO_WINDOW_MS };
          setPendingUndos((current) => [...current, entry]);
        }
        await refreshAll();
        return result.ok;
      } catch (error) {
        rollback?.();
        show('error', errorText(error));
        // The cache is back to what it was; the refetch makes sure it is also what the server has.
        await refreshAll();
        return false;
      }
    });
  }

  /**
   * Every approve, the pane's and the ✨ ones. Final, so never an Undo: the
   * cache shows the PRs approved and the toast says "Approved" before GitHub
   * answers. A failed PR is put back (the whole call, when it all failed) and
   * the server's message replaces the toast. The busy key holds until the
   * refetch: the topic's own offers are core's and are not worked out here.
   * Returns true when every PR was approved.
   */
  async function runApprove(busyKey: string, prKeys: PrKey[], task: () => Promise<ActionResult & { results: PrApproveResult[] }>): Promise<boolean> {
    if (isBlocked('approve')) {
      return false;
    }
    return withBusy(busyKey, async () => {
      const showApproved = (keys: PrKey[]) => {
        const at = new Date().toISOString();
        return Promise.all([
          changeCache<TopicDetail>(['topic'], (detail) => withApprovedPrs(detail, keys)),
          ...keys.map((key) => changeCache<PrDetail>(queryKeys.pr(key), (detail) => approvedDetail(detail, at))),
        ]).then((rollbacks) => () => rollbacks.forEach((rollback) => rollback()));
      };
      let rollback: (() => void) | null = null;
      let allApproved = false;
      try {
        rollback = await showApproved(prKeys);
        show('ok', approvedMessage(prKeys.length));
        const result = await task();
        const failed = result.results.filter((entry) => !entry.ok).map((entry) => entry.prKey);
        allApproved = failed.length === 0;
        if (failed.length > 0) {
          rollback();
          const worked = prKeys.filter((key) => !failed.includes(key));
          rollback = worked.length > 0 ? await showApproved(worked) : null;
          show('error', result.message);
        }
        if (result.settleToken) {
          const entry = { token: result.settleToken, until: Date.now() + UNDO_WINDOW_MS };
          setPendingUndos((current) => [...current, entry]);
        }
      } catch (error) {
        rollback?.();
        show('error', errorText(error));
      }
      await refreshAll();
      return allApproved;
    });
  }

  async function sync(): Promise<void> {
    setSyncing(true);
    try {
      const report = await request<SyncReport>('POST', '/api/sync');
      if (report.blockedBy) {
        // Not a sync: the last real one stays in the title bar, the note in the middle says how to fix it.
        show('blocked', `Sync skipped: ${report.blockedBy}`);
        await refreshAll();
        return;
      }
      setLastSync(report);
      const capped = capNote(report.agentCallStats, config?.autoSyncMinutes ?? 0);
      if (report.errors.length > 0) {
        show('error', `Synced with ${report.errors.length} problem(s): ${report.errors[0]}`);
      } else if (capped) {
        show('blocked', `Synced, ${capped}. Sync again to continue.`);
      }
      await refreshAll();
    } catch (error) {
      show('error', `Sync failed: ${errorText(error)}`);
    } finally {
      setSyncing(false);
    }
  }

  async function checkTools(): Promise<void> {
    try {
      const view = await withBusy('tools:check', () => request<ToolsView>('POST', '/api/tools/check'));
      queryClient.setQueryData(queryKeys.tools, view);
      const stillOff = [view.canSync ? null : view.gh.headline, view.agentOn ? null : view.claude.headline].filter((line) => line !== null);
      show(stillOff.length > 0 ? 'blocked' : 'ok', stillOff.length > 0 ? `Still: ${stillOff.join('. ')}` : 'gh and claude work');
      await refreshAll();
    } catch (error) {
      show('error', `Could not check: ${errorText(error)}`);
    }
  }

  async function setGitHubWrites(enabled: boolean): Promise<boolean> {
    try {
      const change = await withBusy('github-writes', () => request<GitHubWritesChange>('POST', '/api/github-writes', { enabled }));
      show(change.ok ? 'ok' : 'blocked', change.message);
      await refreshAll();
      return change.ok;
    } catch (error) {
      show('error', `Could not switch GitHub writes: ${errorText(error)}`);
      return false;
    }
  }

  async function settlePendingWrites(path: 'send' | 'discard'): Promise<void> {
    try {
      const result = await withBusy('github-writes', () => request<PendingWritesResult>('POST', `/api/github-writes/pending/${path}`));
      show(result.ok ? 'ok' : 'error', result.message);
      await refreshAll();
    } catch (error) {
      show('error', `Could not ${path} the pending writes: ${errorText(error)}`);
    }
  }

  async function undo(undoToken: string): Promise<void> {
    setPendingUndos((current) => current.filter((entry) => entry.token !== undoToken));
    await run(`undo:${undoToken}`, null, () => request('POST', '/api/undo', { undoToken }));
  }

  async function feedback(input: FeedbackInput): Promise<void> {
    // "Not mine" also queues the GitHub mark-read, see FeedbackActions.
    const write = input.kind === 'not_mine' ? 'notMine' : null;
    await run(`feedback:${input.tileId}`, write, () => request('POST', '/api/feedback', input));
  }

  async function markTopicSeen(topicId: string): Promise<void> {
    try {
      await request<ActionResult>('POST', `/api/topics/${encodeURIComponent(topicId)}/seen`);
      await queryClient.invalidateQueries({ queryKey: queryKeys.topic(topicId) });
    } catch (error) {
      show('error', `Could not mark the topic seen: ${errorText(error)}`);
    }
  }

  /** No toast: the dialog closes and the held sync shows in the title bar. */
  async function startAsUsual(): Promise<boolean> {
    try {
      const result = await withBusy(CLEANUP_BUSY.start, () => request<ActionResult>('POST', '/api/inbox-cleanup/start-as-usual'));
      await refreshAll();
      return result.ok;
    } catch (error) {
      show('error', errorText(error));
      return false;
    }
  }

  async function archiveTopic(topicId: string): Promise<void> {
    try {
      const path = `/api/topics/${encodeURIComponent(topicId)}/archive`;
      const result = await withBusy(`archiveTopic:${topicId}`, () => request<ActionResult>('POST', path));
      show(result.ok ? 'ok' : 'error', result.message);
      // The Archive list first: a topic in neither list makes the view fall back to another topic and pin it.
      await queryClient.invalidateQueries({ queryKey: queryKeys.finishedTopics });
      await refreshAll();
    } catch (error) {
      show('error', `Could not archive the topic: ${errorText(error)}`);
    }
  }

  async function setTopicDriver(topicId: string, driver: string | null): Promise<void> {
    try {
      const path = `/api/topics/${encodeURIComponent(topicId)}/driver`;
      const result = await withBusy(`topicDriver:${topicId}`, () => request<ActionResult>('POST', path, { driver }));
      // The topic moving in the sidebar is the confirmation; only a refusal says something.
      await refreshAll();
      if (result.ok) {
        setTopicMoves((count) => count + 1);
      } else {
        show('error', result.message);
      }
    } catch (error) {
      show('error', `Could not set the driver: ${errorText(error)}`);
    }
  }

  async function markOpenedRead(prKey: PrKey): Promise<OpenedReadResult | null> {
    if (writeBlockedReason('openedRead', writes) !== null) {
      return null;
    }
    try {
      const result = await request<OpenedReadResult>('POST', `${prPath(prKey)}/opened`);
      const token = result.undoToken;
      if (token) {
        // Counted in the footer and refetched when the engine's window ends, like a clicked mark-read.
        const until = result.undoUntil === null ? Date.now() + UNDO_WINDOW_MS : Date.parse(result.undoUntil);
        setPendingUndos((current) => [...current, { token, until }]);
      }
      if (result.marked) {
        // Not awaited: the button's Undo window runs from this answer, not from when the refetch lands.
        void refreshAll();
      }
      return result;
    } catch {
      // Nobody clicked anything, so nothing to report: the next open or sync tries again.
      return null;
    }
  }

  async function refreshGlanceOnLook(prKey: PrKey): Promise<void> {
    try {
      const result = await request<GlanceLookResult>('POST', `${prPath(prKey)}/glance/look`);
      // A run started or queued: refetch now, so the card says "Updating now" without waiting for the live status.
      if (result.outcome === 'started' || result.outcome === 'queued') {
        await refreshAll();
      }
    } catch {
      // Nobody clicked anything, so nothing to report: the next open or sync tries again.
    }
  }

  async function setRepoScope(repo: string | null): Promise<void> {
    try {
      await withBusy('repos', () => request<RepoOverview>('POST', '/api/repos/scope', { repo }));
      await refreshAll();
    } catch (error) {
      show('error', `Could not change the repo filter: ${errorText(error)}`);
    }
  }

  async function setRepoQuiet(repo: string, quiet: boolean): Promise<void> {
    try {
      await withBusy('repos', () => request<RepoOverview>('POST', '/api/repos/quiet', { repo, quiet }));
      show('ok', quiet ? `${repo} goes quiet: still synced, never urgent, never pings` : `${repo} counts again`);
      await refreshAll();
    } catch (error) {
      show('error', `Could not change ${repo}: ${errorText(error)}`);
    }
  }

  async function setTeamRole(team: TeamRoleView, role: TeamRole): Promise<void> {
    try {
      await withBusy(`teamRole:${team.team}`, () => request<TeamRolesView>('POST', '/api/team-roles', { team: team.team, role }));
      show('ok', teamRoleNotice(team.slug, role));
      await refreshAll();
    } catch (error) {
      show('error', `Could not change ${team.slug}: ${errorText(error)}`);
    }
  }

  async function setInterruptions(mode: InterruptionsMode): Promise<void> {
    const rollback = await changeCache<InterruptionsView>(queryKeys.interruptions, (view) => ({ ...view, mode }));
    try {
      const view = await withBusy('interruptions', () => request<InterruptionsView>('PUT', '/api/interruptions', { mode }));
      queryClient.setQueryData(queryKeys.interruptions, view);
    } catch (error) {
      rollback();
      show('error', `Could not change interruptions: ${errorText(error)}`);
    }
  }

  async function sendTestNotification(): Promise<void> {
    const send = window.postpile?.sendTestNotification;
    if (!send) {
      show('blocked', 'Test notifications only work in the desktop app');
      return;
    }
    const result = await send();
    if (result === 'shown') {
      show('ok', 'Test notification sent. Nothing showed up? Allow PostPile (dev runs: Electron) in System Settings › Notifications.');
    } else if (result === 'off') {
      show('blocked', 'Mac notifications are off for this run (POSTPILE_MAC_NOTIFICATIONS=0)');
    } else {
      show('error', 'This system does not support notifications');
    }
  }

  /** An agent draft of a PR comment from `path`; a failure says why in the toast and returns null. */
  async function draft(busyKey: string, path: string, body: object): Promise<string | null> {
    try {
      const result = await withBusy(busyKey, () => request<{ body: string }>('POST', path, body));
      return result.body;
    } catch (error) {
      show('error', `Draft failed: ${errorText(error)}`);
      return null;
    }
  }

  async function recheckMemory(body: MemoryRecheckRequest): Promise<MemoryRecheckResult | null> {
    try {
      return await withBusy(`recheck:${body.factId ?? body.text}`, () => request<MemoryRecheckResult>('POST', '/api/memory/recheck', body));
    } catch (error) {
      show('error', `Recheck failed: ${errorText(error)}`);
      return null;
    }
  }

  async function topicChat(topicId: string, message: string): Promise<ChatReply | null> {
    try {
      const path = `/api/topics/${encodeURIComponent(topicId)}/chat`;
      const reply = await withBusy(`chat:${topicId}`, () => request<ChatReply>('POST', path, { message }));
      await queryClient.invalidateQueries({ queryKey: queryKeys.topicChat(topicId) });
      return reply;
    } catch (error) {
      show('error', `Chat failed: ${errorText(error)}`);
      return null;
    }
  }

  async function instructionsChat(message: string): Promise<InstructionsChatReply | null> {
    try {
      const reply = await withBusy('instructions:chat', () => request<InstructionsChatReply>('POST', '/api/instructions/chat', { message }));
      await queryClient.invalidateQueries({ queryKey: queryKeys.instructionsChat });
      return reply;
    } catch (error) {
      show('error', `Chat failed: ${errorText(error)}`);
      return null;
    }
  }

  async function proposeInstructions(sourceChatMessageId: number): Promise<InstructionsProposal | null> {
    try {
      const body = { sourceChatMessageId };
      const reply = await withBusy('instructions:propose', () => request<InstructionsProposalReply>('POST', '/api/instructions/proposals', body));
      if (!reply.proposal) {
        show('error', reply.reply || 'That does not change your instructions.');
      }
      return reply.proposal;
    } catch (error) {
      show('error', `Could not propose a change: ${errorText(error)}`);
      return null;
    }
  }

  /** A rebased result is not an error: the proposal comes back for another look, with the reason as the notice. */
  async function saveInstructions(decision: InstructionsDecision): Promise<InstructionsSaveResult | null> {
    try {
      const result = await withBusy('instructions:save', () => request<InstructionsSaveResult>('POST', '/api/instructions', decision));
      show(result.ok ? 'ok' : result.rebased ? 'blocked' : 'error', result.message);
      await refreshAll();
      return result;
    } catch (error) {
      show('error', `Could not save your instructions: ${errorText(error)}`);
      return null;
    }
  }

  async function teachLesson(prKey: PrKey, note: string): Promise<TeachLessonResult | null> {
    try {
      const result = await withBusy(`teach:${prKey}`, () => request<TeachLessonResult>('POST', '/api/lessons/teach', { prKey, note }));
      // A new lesson waits in its topic's marker too.
      await queryClient.invalidateQueries({ queryKey: queryKeys.lessonsAll });
      return result;
    } catch (error) {
      show('error', `Could not teach the lesson: ${errorText(error)}`);
      return null;
    }
  }

  async function proposeInstructionsFromLesson(lessonId: number): Promise<InstructionsProposalReply | null> {
    try {
      return await withBusy(`lesson:${lessonId}`, () => request<InstructionsProposalReply>('POST', `/api/lessons/${lessonId}/propose-instructions`));
    } catch (error) {
      show('error', `Could not propose a change: ${errorText(error)}`);
      return null;
    }
  }

  async function refreshWorkContext(): Promise<void> {
    try {
      // Shows "running" right away: the view is refetched while the sweep works.
      const sweep = request<WorkContextSweepResult>('POST', '/api/work-context/sweep');
      await queryClient.invalidateQueries({ queryKey: queryKeys.workContext });
      const result = await withBusy('workContext:refresh', () => sweep);
      show(result.ok ? 'ok' : 'error', result.message);
      await queryClient.invalidateQueries({ queryKey: queryKeys.workContext });
    } catch (error) {
      show('error', `Refresh failed: ${errorText(error)}`);
    }
  }

  async function startSetupSweep(): Promise<void> {
    try {
      const view = await withBusy('setup:sweep', () => request<SetupSweepView>('POST', '/api/setup/sweep'));
      queryClient.setQueryData(queryKeys.setupSweep, view);
    } catch (error) {
      show('error', `Could not start the sweep: ${errorText(error)}`);
    }
  }

  async function refineSetup(body: SetupRefineRequest): Promise<SetupRefineResult | null> {
    try {
      const result = await withBusy('setup:refine', () => request<SetupRefineResult>('POST', '/api/setup/refine', body));
      if (!result.ok) {
        show('error', result.message);
      }
      return result;
    } catch (error) {
      show('error', `Could not refine the draft: ${errorText(error)}`);
      return null;
    }
  }

  /** A failed check shows in the fit panel itself, not as a toast: it never blocks the accept. */
  async function checkSetupFit(body: SetupFitRequest): Promise<SetupFitResult> {
    try {
      return await withBusy('setup:fit', () => request<SetupFitResult>('POST', '/api/setup/fit', body));
    } catch (error) {
      return { ok: false, message: `Could not check the text: ${errorText(error)}`, notes: [] };
    }
  }

  /** A refused accept (the file changed meanwhile) is not an error: the result carries the new text to diff against. */
  async function acceptSetup(body: SetupAcceptRequest): Promise<SetupAcceptResult | null> {
    try {
      const result = await withBusy('setup:accept', () => request<SetupAcceptResult>('POST', '/api/setup/accept', body));
      show(result.ok ? 'ok' : result.current ? 'blocked' : 'error', result.message);
      await refreshAll();
      return result;
    } catch (error) {
      show('error', `Could not accept the draft: ${errorText(error)}`);
      return null;
    }
  }

  const actions: Actions = {
    config,
    writes,
    notice,
    dismissNotice: () => setNotice(null),
    syncing: syncing || backgroundSync,
    topicMoves,
    // A background sync after this window's last "Sync now" is the newer one.
    lastSync: newerReport(lastSync, storedLastSync),
    // Memory corrections carry undo tokens too, but only mark-reads wait to reach GitHub.
    pendingMarkReads: pendingUndos.filter((entry) => !entry.token.startsWith(MEMORY_UNDO_PREFIX)).length,
    isBusy: (key) => busy.includes(key),
    blockedReason: (write) => writeBlockedReason(write, writes),

    sync,
    checkTools,
    setGitHubWrites,
    sendPendingWrites: () => settlePendingWrites('send'),
    discardPendingWrites: () => settlePendingWrites('discard'),
    markThreadRead: async (threadId) => {
      await run(`markThread:${threadId}`, 'markRead', () => request('POST', `/api/notifications/${encodeURIComponent(threadId)}/mark-read`));
    },
    approve: (prKey, headOid, body = '') =>
      runApprove(`approve:${prKey}`, [prKey], async () => {
        const result = await request<ActionResult>('POST', `${prPath(prKey)}/approve`, { headOid, body });
        return { ...result, results: [{ prKey, ok: result.ok, message: result.message }] };
      }),
    commentReview: (prKey, headOid, body) =>
      run(`commentReview:${prKey}`, 'commentReview', () => request('POST', `${prPath(prKey)}/comment-review`, { headOid, body })),
    approveAgent: async (input) => {
      const prKeys = input.prs.map((pr) => pr.prKey);
      await runApprove(input.busyKey, prKeys, () => request<BatchApproveResult>('POST', '/api/agent-actions/approve', { prs: input.prs, from: input.from }));
    },
    removeTeamRequest: async (prKey, team) => {
      await run(`removeTeam:${prKey}`, 'removeTeam', () => request('POST', `${prPath(prKey)}/remove-team-request`, { team }));
    },
    retryGlance: async (prKey) => {
      sendTelemetry('glance_retry_clicked', {});
      await run(`retryGlance:${prKey}`, null, () => request('POST', `${prPath(prKey)}/glance/retry`));
    },
    markRead: async (tileId, afterRead) => {
      const shape: NoticeShape | null = afterRead
        ? (result) => {
            const notice = markReadNotice({ message: result.message, ok: result.ok, writesOn: writes?.enabled ?? false, afterRead });
            return { message: notice.message, snoozeTileId: notice.offerSnooze ? tileId : null };
          }
        : null;
      // Locked, a mark-read changes nothing in the app until it is a pending write: nothing to show early.
      const optimistic = afterRead && writes?.enabled ? () => changeTile(tileId, markedReadTile) : null;
      await run(`markRead:${tileId}`, 'markRead', () => request('POST', `${tilePath(tileId)}/mark-read`), shape, optimistic);
    },
    markTilesRead: async (input) => {
      // The engine re-checks each tile at click time and names the ones it skipped in its message: that wins over the offer's count.
      const shape: NoticeShape = (result) => ({
        message: result.ok && !result.message.includes('; skipped') ? batchMarkReadMessage(input.tileIds.length, input.skipped, result.message, writes?.enabled ?? false) : result.message,
        snoozeTileId: null,
      });
      // One cache change, so one snapshot: the rollback restores the topic as it was before any tile changed.
      const optimistic = writes?.enabled ? () => changeCache<TopicDetail>(['topic'], (detail) => withTiles(detail, input.tileIds, markedReadTile)) : null;
      const body = { tileIds: input.tileIds, from: 'agent_topic' };
      await run(input.busyKey, 'markRead', () => request<ActionResult>('POST', '/api/agent-actions/mark-read', body), shape, optimistic);
    },
    markPrRead: async (tileId, prKey, afterRead) => {
      const shape: NoticeShape = (result) => {
        const notice = markReadNotice({ message: result.message, ok: result.ok, writesOn: writes?.enabled ?? false, afterRead });
        return { message: notice.message, snoozeTileId: null };
      };
      const optimistic = writes?.enabled ? () => changeTile(tileId, (view) => markedReadPr(view, prKey)) : null;
      await run(`markPr:${tileId}:${prKey}`, 'markRead', () => request('POST', `${tilePrPath(tileId, prKey)}/mark-read`), shape, optimistic);
    },
    snooze: async (tileId, condition) => {
      await run(`snooze:${tileId}`, null, () => request('POST', `${tilePath(tileId)}/snooze`, { condition }), null, () => changeTile(tileId, snoozedTile));
    },
    unsnooze: async (tileId) => {
      await run(`snooze:${tileId}`, null, () => request('DELETE', `${tilePath(tileId)}/snooze`));
    },
    undo,
    feedback,
    unmute: async (eventId) => {
      await run(`unmute:${eventId}`, null, () => request('POST', `/api/events/${encodeURIComponent(eventId)}/unmute`));
    },
    decideTailoring: async (topicId, text, keep) => {
      const path = `/api/topics/${encodeURIComponent(topicId)}/tailoring`;
      await run(`tailoring:${topicId}`, null, () => request('POST', path, { text, keep }));
    },
    decideProposal: async (proposalId, accept) => {
      const path = `/api/proposals/${encodeURIComponent(proposalId)}`;
      await run(`proposal:${proposalId}`, null, () => request('POST', path, { accept }));
    },
    decideRuleProposal: async (proposalId, accept) => {
      const path = `/api/rule-proposals/${encodeURIComponent(proposalId)}`;
      await run(`rule:${proposalId}`, null, () => request('POST', path, { accept }));
    },
    correctMemory: (input) => run(`correct:${input.factId ?? input.text}`, null, () => request('POST', '/api/memory/corrections', input)),
    recheckMemory,
    setRepoScope,
    setRepoQuiet,
    setTeamRole,
    setInterruptions,
    sendTestNotification,
    // One busy key each: withBusy drops every copy of a key when one run ends.
    clearInbox: (cleanupRequest) => run(CLEANUP_BUSY.clear, 'cleanup', () => request('POST', '/api/inbox-cleanup/clear', cleanupRequest)),
    clearSafeMerged: (safeRequest) => run(CLEANUP_BUSY.clearSafe, 'cleanup', () => request('POST', '/api/inbox-cleanup/clear-safe', safeRequest)),
    startAsUsual,
    connectMcp: (from) => run('mcp:connect', null, () => request('POST', '/api/mcp-connection', { from })),
    hideMcpConnect: () => run('mcp:not-now', null, () => request('POST', '/api/mcp-connection/not-now')),
    markTopicSeen,
    archiveTopic,
    setTopicDriver,
    markOpenedRead,
    refreshGlanceOnLook,
    draftAsk: (prKey, person, intent) => draft(`ask:${prKey}`, `${prPath(prKey)}/draft-ask`, { person, intent }),
    draftReviewNote: (prKey, kind, gist = '') => draft(`reviewNote:${prKey}`, `${prPath(prKey)}/draft-review-note`, { kind, gist }),
    draftReply: (prKey, commentId, gist) => draft(`reply:${prKey}:${commentId}`, `${prPath(prKey)}/draft-reply`, { commentId, gist }),
    sendComment: (prKey, body) => run(`comment:${prKey}`, 'comment', () => request('POST', `${prPath(prKey)}/comment`, { body })),
    replyToComment: (prKey, commentId, body) =>
      run(`replySend:${prKey}:${commentId}`, 'reply', () => request('POST', `${prPath(prKey)}/reply`, { commentId, body })),
    react: (prKey, commentId) => run(`react:${prKey}:${commentId}`, 'react', () => request('POST', `${prPath(prKey)}/react`, { commentId })),
    topicChat,
    instructionsChat,
    proposeInstructions,
    saveInstructions,
    teachLesson,
    // run() refetches everything: the topic's lessons, its tailoring and the instructions.
    keepLessonForTopic: (lessonId) => run(`lesson:${lessonId}`, null, () => request('POST', `/api/lessons/${lessonId}/keep-topic`)),
    dismissLesson: (lessonId) => run(`lesson:${lessonId}`, null, () => request('POST', `/api/lessons/${lessonId}/dismiss`)),
    proposeInstructionsFromLesson,
    refreshWorkContext,
    forgetWorkThread: (input) =>
      run(`forget:${input.version}:${input.index}`, null, () => request('POST', '/api/work-context/forget', input)),
    saveSweepSkip: (patterns) => run('workContext:skip', null, () => request('PUT', '/api/work-context/skip-list', { patterns })),
    startSetupSweep,
    refineSetup,
    checkSetupFit,
    acceptSetup,
    skipSetup: () => run('setup:skip', null, () => request('POST', '/api/setup/skip')),
  };

  return <ActionsContext.Provider value={actions}>{props.children}</ActionsContext.Provider>;
}
