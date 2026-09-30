// The one place the renderer changes anything. Components call useActions();
// nothing else may send a POST or DELETE to the API. Actions that end up as a
// GitHub write go through the guard in lib/guard.ts first.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import type {
  ActionResult,
  AppConfig,
  ChatReply,
  CleanupAge,
  FeedbackInput,
  GitHubWritesChange,
  GitHubWritesStatus,
  InstructionsChatReply,
  InstructionsDecision,
  InstructionsProposal,
  InstructionsProposalReply,
  InstructionsSaveResult,
  McpConnectFrom,
  MemoryCorrection,
  MemoryRecheckRequest,
  MemoryRecheckResult,
  OpenedReadResult,
  PendingWritesResult,
  PrDetail,
  PrKey,
  RepoOverview,
  SetupAcceptRequest,
  SetupAcceptResult,
  SetupFitRequest,
  SetupFitResult,
  SetupRefineRequest,
  SetupRefineResult,
  SetupSweepView,
  SnoozeCondition,
  SyncReport,
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
import { markReadNotice } from '../lib/mark-read.ts';
import { approvedDetail, markedReadPr, markedReadTile, snoozedTile, withTile } from '../lib/optimistic.ts';
import { newerReport } from '../lib/sync-report.ts';
import { teamRoleNotice } from '../lib/team-roles.ts';
import { useLiveStatus } from './live.ts';
import { useAppConfig } from './config.ts';
import { useLastSyncReport } from './sync.ts';
import { useGitHubWrites } from './writes.ts';
import { prPath, request, tilePath, tilePrPath } from './client.ts';
import { queryKeys } from './keys.ts';
import { sendTelemetry } from './telemetry.ts';

// Matches UNDO_WINDOW_MS in the engine. The renderer imports types only.
const UNDO_WINDOW_MS = 6000;
const NOTICE_MS = 6000;
// Matches the engine's memory correction undo tokens.
const MEMORY_UNDO_PREFIX = 'memory:';
const PROBLEM_NOTICE_MS = 12000;
/** Busy keys of the inbox cleanup's actions, one each (see withBusy). */
export const CLEANUP_BUSY = {
  markRead: 'cleanup:mark-read',
  notNow: 'cleanup:not-now',
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
   * The PR stayed open in the detail pane: the server marks its GitHub thread
   * read when nothing is asked of the user. Quiet (no toast, no undo), and
   * never sent while GitHub writes are locked.
   */
  markOpenedRead(prKey: PrKey): Promise<void>;
  /** `headOid`: the head commit on screen; the server refuses the approval when the PR moved past it. */
  approve(prKey: PrKey, headOid: string): Promise<void>;
  /** "Remove <team>": removes the team's review request, unsubscribes and marks the PR done. Final, no undo; blocked while locked. */
  removeTeamRequest(prKey: PrKey, team: string): Promise<void>;
  /** Retry on a failed glance: a catch-up run for the PR's topic. Agent calls only, not a GitHub write. */
  retryGlance(prKey: PrKey): Promise<void>;
  /** `afterRead`: what the tile would be after it (`TileView.afterRead`), so the toast can say it is still your move. */
  markRead(tileId: string, afterRead?: TileAfterRead): Promise<void>;
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
   * "Mark everything older than N days read on GitHub". A GitHub write: with
   * the lock closed it becomes one pending write. Returns whether it went through.
   */
  cleanUpInbox(age: CleanupAge): Promise<boolean>;
  /** "Not now": hides the cleanup for a week. Local. */
  hideInboxCleanup(): Promise<boolean>;
  /**
   * "Add to Claude Code": the server runs `claude mcp add` (installed app
   * only). Local, not a GitHub write; fire it only from a click. Returns
   * whether Claude Code has the server afterwards.
   */
  connectMcp(from: McpConnectFrom): Promise<boolean>;
  /** "Not now" on the footer's MCP offer. Local, kept by the server. */
  hideMcpConnect(): Promise<boolean>;
  /** "Send test notification" (desktop app only, over the preload). Says in a toast what happened. */
  sendTestNotification(): Promise<void>;
  /** Quiet: no toast. Called when the user leaves a topic. */
  markTopicSeen(topicId: string): Promise<void>;
  /** Returns the agent's draft, or null when drafting failed. */
  draftAsk(prKey: PrKey, person: string, intent: string): Promise<string | null>;
  /** Returns true when the comment went out. */
  sendComment(prKey: PrKey, body: string): Promise<boolean>;
  chat(tileId: string, message: string): Promise<ChatReply | null>;
  /** A message in the "Your instructions" chat. Local, not a GitHub write. */
  instructionsChat(message: string): Promise<InstructionsChatReply | null>;
  /** "Keep for all topics": the user's chat message asked as an instructions change. Null when it changes nothing. */
  proposeInstructions(sourceChatMessageId: number): Promise<InstructionsProposal | null>;
  /** Accepts a proposal: writes instructions.md. Local, not a GitHub write. */
  saveInstructions(decision: InstructionsDecision): Promise<InstructionsSaveResult | null>;
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
        return false;
      }
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

  async function markOpenedRead(prKey: PrKey): Promise<void> {
    if (writeBlockedReason('openedRead', writes) !== null) {
      return;
    }
    try {
      const result = await request<OpenedReadResult>('POST', `${prPath(prKey)}/opened`);
      if (result.marked) {
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

  async function draftAsk(prKey: PrKey, person: string, intent: string): Promise<string | null> {
    try {
      const draft = await withBusy(`ask:${prKey}`, () =>
        request<{ body: string }>('POST', `${prPath(prKey)}/draft-ask`, { person, intent }),
      );
      return draft.body;
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

  async function chat(tileId: string, message: string): Promise<ChatReply | null> {
    try {
      const reply = await withBusy(`chat:${tileId}`, () => request<ChatReply>('POST', `${tilePath(tileId)}/chat`, { message }));
      await queryClient.invalidateQueries({ queryKey: queryKeys.chat(tileId) });
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
    approve: async (prKey, headOid) => {
      const optimistic = () => changeCache<PrDetail>(queryKeys.pr(prKey), (detail) => approvedDetail(detail, new Date().toISOString()));
      await run(`approve:${prKey}`, 'approve', () => request('POST', `${prPath(prKey)}/approve`, { headOid }), null, optimistic);
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
    sendTestNotification,
    // One busy key each: withBusy drops every copy of a key when one run ends.
    cleanUpInbox: (age) => run(CLEANUP_BUSY.markRead, 'cleanup', () => request('POST', '/api/inbox-cleanup/mark-read', { olderThanDays: age })),
    hideInboxCleanup: () => run(CLEANUP_BUSY.notNow, null, () => request('POST', '/api/inbox-cleanup/not-now')),
    connectMcp: (from) => run('mcp:connect', null, () => request('POST', '/api/mcp-connection', { from })),
    hideMcpConnect: () => run('mcp:not-now', null, () => request('POST', '/api/mcp-connection/not-now')),
    markTopicSeen,
    markOpenedRead,
    draftAsk,
    sendComment: (prKey, body) => run(`comment:${prKey}`, 'comment', () => request('POST', `${prPath(prKey)}/comment`, { body })),
    chat,
    instructionsChat,
    proposeInstructions,
    saveInstructions,
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
