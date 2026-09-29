// The runtime switch for GitHub writes and the log of every action that
// could reach GitHub (plus local mark-reads).

import type { IsoTime, PrKey } from './types.ts';

/**
 * Whether the app may write to GitHub right now. Off (read-only) on first run;
 * the user flips it with the lock in the status footer and the choice is kept
 * in the store. POSTPILE_READ_ONLY=1 forces it off: then `forcedOffReason`
 * says why and turning it on is refused.
 */
export interface GitHubWritesStatus extends WriteSwitchState {
  /** Mark-reads waiting for the user to unlock (or discard), oldest first. */
  pending: PendingWriteView[];
}

/** A GitHub notification thread a mark-read covers, with its updated_at as of the last sync. */
export interface PendingThread {
  id: string;
  updatedAt: IsoTime;
  /** Null for issues, releases and other non-PR threads. */
  prKey: PrKey | null;
}

/**
 * mark_read: one click's threads. mark_all_read_before: the inbox cleanup's
 * single PUT /notifications with last_read_at = `readBefore`.
 */
export type PendingWriteKind = 'mark_read' | 'mark_all_read_before';

/**
 * A mark-read made while GitHub writes were locked. Nothing changed in the
 * app: the tile keeps its state until the write reaches GitHub. Stored, so it
 * survives a restart; one row per click (tile, debug row, "not mine").
 */
export interface PendingWrite {
  id: number;
  kind: PendingWriteKind;
  createdAt: IsoTime;
  origin: ActionOrigin;
  tileId: string | null;
  /** The batch id of the click, links the log rows. */
  batch: string;
  /** Every PR the click covered; they turn read here once the write is through. */
  prKeys: PrKey[];
  /** PRs that also count as handled then (pinged members). */
  handleKeys: PrKey[];
  /** Threads still to mark read on GitHub. Empty for mark_all_read_before. */
  threads: PendingThread[];
  /** mark_all_read_before: the cutoff sent as last_read_at. Null for mark_read. */
  readBefore: IsoTime | null;
  /** The last send's error, null before any try. */
  error: string | null;
  triedAt: IsoTime | null;
}

/** A pending write as the footer lists it. */
export interface PendingWriteView {
  id: number;
  kind: PendingWriteKind;
  createdAt: IsoTime;
  origin: ActionOrigin;
  /** Tile or PR title, or the notification's title for a thread without a stored PR. */
  title: string;
  prKeys: PrKey[];
  tileId: string | null;
  /** For mark_all_read_before: stored unread threads older than the cutoff, as far as the app knows. */
  threadCount: number;
  error: string | null;
}

/** Answer to "Send N to GitHub" or "Discard". */
export interface PendingWritesResult {
  ok: boolean;
  message: string;
  /** Pending writes that are done (sent, already read, or left unread on purpose). */
  done: number;
  /** Pending writes that failed and stay pending with their error. */
  failed: number;
  status: GitHubWritesStatus;
}

/** The lock alone: on or off, and why it is forced off. */
export interface WriteSwitchState {
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
 * What was done. `undo_mark_read` is the 6s undo, `writes_on` / `writes_off`
 * the lock. `bring_back` is gone (GitHub has no mark-unread, so it only split
 * the state); old rows may still carry it.
 * `mark_all_read_before` is the inbox cleanup (PUT /notifications).
 * `agent_refresh` is an outside agent's refresh_from_github: a GitHub read,
 * logged with no thread or PR (the detail lists the PRs) so it never shows
 * as a thread's last action.
 * `remove_team_request` and `unsubscribe` are the detail pane's "Remove
 * <team>" (2026-09-29). mark_done and subscribe get added with their writer
 * methods; nothing sends them today.
 */
export type LoggedAction =
  | 'mark_read'
  | 'mark_all_read_before'
  | 'undo_mark_read'
  | 'approve'
  | 'comment'
  | 'remove_team_request'
  | 'unsubscribe'
  | 'bring_back'
  | 'writes_on'
  | 'writes_off'
  | 'agent_refresh';

/**
 * Who decided it.
 * - tile: the user in a tile (and, before 2026-09-29, the detail pane)
 * - detail: the user in the detail pane (PR-scoped mark read, removing a team review request)
 * - debug: the user in the notifications debug view
 * - queue: the deferred mark-read queue, when a batch's undo window ran out
 * - quit: the queue flushed on quit
 * - sync / poll: the full sync or the live poll saw a thread leave the inbox
 *   (read on github.com or another client) and mirrored it locally
 * - footer: the lock in the status footer (also sending or discarding pending writes)
 * - cleanup: the inbox cleanup dialog ("mark everything older than N days read")
 * - quiet: PostPile itself, after a full sync: a thread the user had read
 *   turned unread only because of bots ("Handled quietly")
 * - agent: an outside agent through the MCP server (refresh_from_github); a GitHub read, never a write
 */
export type ActionOrigin = 'tile' | 'detail' | 'debug' | 'queue' | 'quit' | 'sync' | 'poll' | 'footer' | 'cleanup' | 'quiet' | 'agent';

/**
 * What came of it.
 * - queued: waiting in the undo window (done locally only while writes are on)
 * - pending: GitHub writes were locked when the undo window ran out; waits
 *   in pending_write for the user to unlock and send, or discard
 * - discarded: a pending write the user dropped; the app stays unread like GitHub
 * - github: reached GitHub
 * - local: only changed the app's own state (nothing unread on GitHub, or the action is local by nature;
 *   older rows: writes were off)
 * - skipped: not sent on purpose (activity after the last sync, or writes off at send time);
 *   the app stays or goes back to unread
 * - failed: GitHub refused or the call broke; `detail` has the error, a mark-read goes back to unread
 * - observed: GitHub already had it; the app only mirrored it
 */
export type ActionOutcome = 'queued' | 'pending' | 'discarded' | 'github' | 'local' | 'skipped' | 'failed' | 'observed';

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
 * local mark-read of a PR without an unread thread carries
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
