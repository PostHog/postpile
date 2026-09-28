// The runtime switch for GitHub writes and the log of every action that
// could reach GitHub (plus local mark-reads and bring-backs).

import type { IsoTime, PrKey } from './types.ts';

/**
 * Whether the app may write to GitHub right now. Off (read-only) on first run;
 * the user flips it with the lock in the status footer and the choice is kept
 * in the store. CODE_MANAGER_READ_ONLY=1 forces it off: then `forcedOffReason`
 * says why and turning it on is refused.
 */
export interface GitHubWritesStatus {
  enabled: boolean;
  forcedOffReason: string | null;
}

/** Answer to a flip of the lock. `ok` false when the env forces read-only. */
export interface GitHubWritesChange {
  ok: boolean;
  message: string;
  status: GitHubWritesStatus;
}

/**
 * What was done. `undo_mark_read` is the 6s undo, `bring_back` the local
 * "bring back" from the debug view, `writes_on` / `writes_off` the lock.
 * mark_done, subscribe and unsubscribe get added with their writer methods;
 * nothing sends them today.
 */
export type LoggedAction = 'mark_read' | 'undo_mark_read' | 'approve' | 'comment' | 'bring_back' | 'writes_on' | 'writes_off';

/**
 * Who decided it.
 * - tile: the user in a tile or the detail pane
 * - debug: the user in the notifications debug view
 * - queue: the deferred mark-read queue, when a batch's undo window ran out
 * - quit: the queue flushed on quit
 * - sync / poll: the full sync or the live poll saw a thread leave the inbox
 *   (read on github.com or another client) and mirrored it locally
 * - footer: the lock in the status footer
 */
export type ActionOrigin = 'tile' | 'debug' | 'queue' | 'quit' | 'sync' | 'poll' | 'footer';

/**
 * What came of it.
 * - queued: done locally, waiting in the undo window before it goes to GitHub
 * - github: reached GitHub
 * - local: only changed the app's own state (writes were off, or the action is local by nature)
 * - skipped: not sent on purpose (already read on GitHub, or activity after the last sync)
 * - failed: GitHub refused or the call broke; `detail` has the error
 * - observed: GitHub already had it; the app only mirrored it
 */
export type ActionOutcome = 'queued' | 'github' | 'local' | 'skipped' | 'failed' | 'observed';

export interface ActionLogEntry {
  id: number;
  at: IsoTime;
  action: LoggedAction;
  origin: ActionOrigin;
  outcome: ActionOutcome;
  threadId: string | null;
  prKey: PrKey | null;
  tileId: string | null;
  /** Undo token of the mark-read batch, so a queue send can be traced back to the click that queued it. */
  batch: string | null;
  detail: string;
}

export type NewActionLogEntry = Omit<ActionLogEntry, 'id'>;

/** Rows the action log endpoint returns when the request names no limit, and at most. */
export const ACTION_LOG_DEFAULT_LIMIT = 200;
export const ACTION_LOG_MAX_LIMIT = 1000;

/** Newest entries by thread and by PR, and the first entry of each batch. */
export interface ActionLogIndex {
  byThread: Map<string, ActionLogEntry>;
  byPrKey: Map<PrKey, ActionLogEntry>;
  firstOfBatch: Map<string, ActionLogEntry>;
}

/** Builds the index from entries in any order (FakeEngine keeps them in a list). */
export function indexActionLog(entries: ActionLogEntry[]): ActionLogIndex {
  const index: ActionLogIndex = { byThread: new Map(), byPrKey: new Map(), firstOfBatch: new Map() };
  for (const entry of [...entries].sort((a, b) => a.id - b.id)) {
    if (entry.threadId !== null) {
      index.byThread.set(entry.threadId, entry);
    }
    if (entry.prKey !== null) {
      index.byPrKey.set(entry.prKey, entry);
    }
    if (entry.batch !== null && !index.firstOfBatch.has(entry.batch)) {
      index.firstOfBatch.set(entry.batch, entry);
    }
  }
  return index;
}

/**
 * The newest thing the app did to a thread or its PR, and for a send of the
 * deferred queue the click that queued it. The PR counts too, since a
 * bring-back or a local mark-read of a PR without an unread thread carries
 * no thread id.
 */
export function actionTrail(
  index: ActionLogIndex,
  threadId: string,
  prKey: PrKey | null,
): { lastAction: ActionLogEntry | null; decidedBy: ActionLogEntry | null } {
  const byThread = index.byThread.get(threadId) ?? null;
  const byPr = prKey === null ? null : (index.byPrKey.get(prKey) ?? null);
  const lastAction = byThread && byPr ? (byThread.id >= byPr.id ? byThread : byPr) : (byThread ?? byPr);
  const sentByQueue = lastAction !== null && (lastAction.origin === 'queue' || lastAction.origin === 'quit');
  const first = sentByQueue && lastAction.batch !== null ? (index.firstOfBatch.get(lastAction.batch) ?? null) : null;
  return { lastAction, decidedBy: first && first.id !== lastAction?.id ? first : null };
}
