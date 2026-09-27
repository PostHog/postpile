// The one place the renderer changes anything. Components call useActions();
// nothing else may send a POST or DELETE to the API. Actions that end up as a
// GitHub write go through the guard in lib/guard.ts first.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type {
  ActionResult,
  AppConfig,
  ChatReply,
  FeedbackInput,
  InstructionsChatReply,
  InstructionsDecision,
  InstructionsProposal,
  InstructionsProposalReply,
  InstructionsSaveResult,
  MemoryCorrection,
  PrKey,
  SnoozeCondition,
  SyncReport,
} from '@code-manager/core';
import { capNote } from '../lib/agent-stats.ts';
import { writeBlockedReason, type GithubWrite } from '../lib/guard.ts';
import { useAppConfig } from './config.ts';
import { prPath, request, tilePath } from './client.ts';
import { queryKeys } from './keys.ts';

// Matches UNDO_WINDOW_MS in the engine. The renderer imports types only.
const UNDO_WINDOW_MS = 6000;
const NOTICE_MS = 6000;
const PROBLEM_NOTICE_MS = 12000;

export type NoticeTone = 'ok' | 'error' | 'blocked';

export interface Notice {
  id: number;
  tone: NoticeTone;
  message: string;
  undoToken: string | null;
}

interface PendingUndo {
  token: string;
  until: number;
}

export interface Actions {
  config: AppConfig | undefined;
  notice: Notice | null;
  dismissNotice(): void;
  syncing: boolean;
  lastSync: SyncReport | null;
  /** Mark-reads still inside their undo window, as far as this window knows. */
  pendingMarkReads: number;
  isBusy(key: string): boolean;
  blockedReason(action: GithubWrite): string | null;

  sync(): Promise<void>;
  approve(prKey: PrKey): Promise<void>;
  markRead(tileId: string): Promise<void>;
  snooze(tileId: string, condition: SnoozeCondition): Promise<void>;
  unsnooze(tileId: string): Promise<void>;
  undo(undoToken: string): Promise<void>;
  feedback(input: FeedbackInput): Promise<void>;
  unmute(eventId: string): Promise<void>;
  decideTailoring(topicId: string, text: string, keep: boolean): Promise<void>;
  decideProposal(proposalId: string, accept: boolean): Promise<void>;
  decideRuleProposal(proposalId: string, accept: boolean): Promise<void>;
  /** "Wrong" / "Forget" on a fact or dossier line. Local memory, not a GitHub write. */
  correctMemory(input: MemoryCorrection): Promise<void>;
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
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState<string[]>([]);
  const [pendingUndos, setPendingUndos] = useState<PendingUndo[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<SyncReport | null>(null);

  // Notices fade on their own; problems stay a little longer.
  useEffect(() => {
    if (!notice) {
      return;
    }
    const timer = setTimeout(() => setNotice(null), notice.tone === 'ok' ? NOTICE_MS : PROBLEM_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  // Drop undo entries once the engine has sent them to GitHub.
  useEffect(() => {
    const first = pendingUndos[0];
    if (!first) {
      return;
    }
    const timer = setTimeout(() => {
      setPendingUndos((current) => current.filter((entry) => entry.until > Date.now()));
    }, Math.max(first.until - Date.now(), 0));
    return () => clearTimeout(timer);
  }, [pendingUndos]);

  function show(tone: NoticeTone, message: string, undoToken: string | null = null): void {
    setNotice({ id: Date.now(), tone, message, undoToken });
  }

  function refreshAll(): Promise<void> {
    // Everything but the config, which is fixed for the process.
    return queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] !== queryKeys.config[0] });
  }

  /** Blocked GitHub writes show why and never reach the API. */
  function isBlocked(write: GithubWrite | null): boolean {
    const reason = write ? writeBlockedReason(write, config) : null;
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

  async function run(busyKey: string, write: GithubWrite | null, task: () => Promise<ActionResult>): Promise<boolean> {
    if (isBlocked(write)) {
      return false;
    }
    try {
      const result = await withBusy(busyKey, task);
      show(result.ok ? 'ok' : 'error', result.message, result.undoToken);
      if (result.undoToken) {
        const entry = { token: result.undoToken, until: Date.now() + UNDO_WINDOW_MS };
        setPendingUndos((current) => [...current, entry]);
      }
      await refreshAll();
      return result.ok;
    } catch (error) {
      show('error', errorText(error));
      return false;
    }
  }

  async function sync(): Promise<void> {
    setSyncing(true);
    try {
      const report = await request<SyncReport>('POST', '/api/sync');
      setLastSync(report);
      const capped = capNote(report.agentCallStats);
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

  const actions: Actions = {
    config,
    notice,
    dismissNotice: () => setNotice(null),
    syncing,
    lastSync,
    pendingMarkReads: pendingUndos.length,
    isBusy: (key) => busy.includes(key),
    blockedReason: (write) => writeBlockedReason(write, config),

    sync,
    approve: async (prKey) => {
      await run(`approve:${prKey}`, 'approve', () => request('POST', `${prPath(prKey)}/approve`));
    },
    markRead: async (tileId) => {
      await run(`markRead:${tileId}`, 'markRead', () => request('POST', `${tilePath(tileId)}/mark-read`));
    },
    snooze: async (tileId, condition) => {
      await run(`snooze:${tileId}`, null, () => request('POST', `${tilePath(tileId)}/snooze`, { condition }));
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
    correctMemory: async (input) => {
      await run(`correct:${input.factId ?? input.text}`, null, () => request('POST', '/api/memory/corrections', input));
    },
    markTopicSeen,
    draftAsk,
    sendComment: (prKey, body) => run(`comment:${prKey}`, 'comment', () => request('POST', `${prPath(prKey)}/comment`, { body })),
    chat,
    instructionsChat,
    proposeInstructions,
    saveInstructions,
  };

  return <ActionsContext.Provider value={actions}>{props.children}</ActionsContext.Provider>;
}
