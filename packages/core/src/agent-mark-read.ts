import { shortHash } from './pr-notes.ts';
import type { IsoTime, PrEvent, PrKey } from './types.ts';

// mark_read from an outside agent (DESIGN.md "Agents mark read"): the agent
// marks PRs read that it read in full with pr_context, through the running
// app, with the same queue, undo and writes lock as the pane's Mark read.
// The guard: a PR with activity PostPile stored after the agent's read is
// refused, so an agent never marks read what it did not see.

/** mark_read takes at most this many PRs per call. */
export const AGENT_MARK_READ_MAX_PRS = 20;

/**
 * One PR to mark read. `seenThrough` is the token pr_context printed with
 * its "Unread since you looked" list (`PrDetail.seenThrough`,
 * `seenThroughToken`).
 */
export interface AgentMarkReadPr {
  prKey: PrKey;
  seenThrough: string;
}

/** What a seen_through token holds: the PR's newest event-log seq, and a hash of the unread list it was printed with. */
export interface SeenThrough {
  seq: number;
  unreadHash: string;
}

/** A hash of a set of event ids, order aside. */
export function unreadIdsHash(ids: string[]): string {
  return shortHash(ids.toSorted().join('\n'));
}

/**
 * The seen_through token: "<seq>-<hash>", e.g. "4127-0k3j2h1g9f8x". The seq
 * catches events logged after the read; the hash of the listed unread ids
 * catches the seen state changing under it (an Undo that brings events
 * back unseen, which never moves the event log).
 */
export function seenThroughToken(seq: number, unreadIds: string[]): string {
  return `${seq}-${unreadIdsHash(unreadIds)}`;
}

/** The token's parts; null when it is not one seenThroughToken made. */
export function parseSeenThrough(token: string): SeenThrough | null {
  const match = /^(\d{1,15})-([0-9a-z]{1,16})$/.exec(token.trim());
  if (!match) {
    return null;
  }
  return { seq: Number(match[1]), unreadHash: match[2] ?? '' };
}

export interface AgentMarkReadRequest {
  prs: AgentMarkReadPr[];
}

/** A PR left alone, and why, in words for the agent. */
export interface AgentMarkReadLeft {
  prKey: PrKey;
  reason: string;
}

export interface AgentMarkReadResult {
  /** Marked read, as one batch with one undo token. */
  marked: PrKey[];
  /** Not marked because the guard said no: unknown PR, a seen_through that does not fit, or new activity since the read. */
  refused: AgentMarkReadLeft[];
  /** Nothing to do: already read, or a stack layer pulled in for context. */
  skipped: AgentMarkReadLeft[];
  /** GitHub writes were locked: the mark-read waits as a pending write until the user unlocks and sends it. */
  writesLocked: boolean;
  /** When the undo window ends; null when nothing was marked. */
  undoUntil: IsoTime | null;
}

/** How long the app keeps an agent mark-read for its toast, and how many: a window shown again after a while still hears of it. */
export const AGENT_READ_NOTICE_KEEP_MS = 3600_000;
export const AGENT_READ_NOTICE_MAX = 20;

/**
 * The app's toast for an agent's mark-read, with Undo while the window
 * runs. `id` grows, so the renderer shows each one once.
 */
export interface AgentReadNotice {
  id: number;
  /** When the agent asked. */
  at: IsoTime;
  /** Its batch can still be undone; false once the window ended. */
  undoable: boolean;
  /** The MCP client's name, e.g. "claude-code"; the renderer maps it to a display name. */
  client: string;
  prKeys: PrKey[];
  writesLocked: boolean;
  undoToken: string;
  undoUntil: IsoTime;
}

/**
 * Recent agent mark-reads, oldest first, for the app's toasts: the last
 * hour, at most 20. Kept past their undo window, so a window that was
 * minimised still says what an agent marked when it polls again, without
 * Undo by then. Two calls between two polls both reach it.
 */
export class AgentReadNotices {
  private count = 0;
  private notices: AgentReadNotice[] = [];

  /** `undoable` says whether a batch can still be undone, by its token (the engine asks its queue). */
  constructor(
    private readonly undoable: (undoToken: string) => boolean,
    private readonly now: () => Date,
  ) {}

  add(client: string, result: AgentMarkReadResult, undoToken: string, undoUntil: IsoTime): void {
    this.count += 1;
    const at = this.now().toISOString();
    this.notices.push({ id: this.count, at, undoable: true, client, prKeys: result.marked, writesLocked: result.writesLocked, undoToken, undoUntil });
  }

  /** The kept ones, each saying whether it can still be undone; older ones are dropped. */
  recent(): AgentReadNotice[] {
    const cutoff = new Date(this.now().getTime() - AGENT_READ_NOTICE_KEEP_MS).toISOString();
    this.notices = this.notices.filter((notice) => notice.at > cutoff).slice(-AGENT_READ_NOTICE_MAX);
    return this.notices.map((notice) => ({ ...notice, undoable: this.undoable(notice.undoToken) }));
  }

  /** Grows with every call that marked something, so the renderer refetches. */
  changes(): number {
    return this.count;
  }
}

/** What the app knows about one PR of the request when it handles it. */
export interface AgentMarkReadInput {
  /** PostPile stores the PR. */
  stored: boolean;
  /** Some tile tracks it (pinged or found); false for a stack layer only pulled in for context. */
  tracked: boolean;
  /** The parsed token; null when the agent passed something pr_context never printed. */
  seenThrough: SeenThrough | null;
  /** `unreadIdsHash` of the PR's unseen events logged at or before the token's seq, now. */
  unreadHashNow: string;
  /** The PR's newest event-log position now; 0 when it has no logged event. */
  newestSeq: number;
  /** The PR's events logged after seenThrough, oldest first. */
  newer: Pick<PrEvent, 'actor' | 'at'>[];
  /**
   * GitHub updated the PR's notification thread after PostPile last fetched
   * the PR (thread `updatedAt` after the snapshot's `fetchedAt`): there is
   * activity no answer could have shown yet, so no seen_through covers it.
   */
  snapshotBehind: boolean;
  /** A mark-read of the PR already waits: in the undo window, or as a pending write while GitHub writes are locked. */
  alreadyQueued: boolean;
  /** A read changes something: an unread GitHub thread, an unseen event, or the PR is not handled yet. */
  changesAnything: boolean;
}

export type AgentMarkReadCheck = { kind: 'mark' } | { kind: 'refused'; reason: string } | { kind: 'skipped'; reason: string };

/** "new activity since you read it: 2 events, newest from alice; read it again with pr_context". */
export function newActivityReason(newer: Pick<PrEvent, 'actor' | 'at'>[]): string {
  const newest = newer.reduce((latest, event) => (event.at > latest.at ? event : latest));
  const count = newer.length === 1 ? '1 event' : `${newer.length} events`;
  return `new activity since you read it: ${count}, newest from ${newest.actor}; read it again with pr_context`;
}

function keyList(left: AgentMarkReadLeft[]): string {
  return left.map((entry) => `${entry.prKey} (${entry.reason})`).join('; ');
}

/** The action log line (`agent_mark_read`) for the whole call: who asked, and what came of each PR. */
export function agentMarkReadLogDetail(client: string, result: AgentMarkReadResult): string {
  const parts = [`${client}: marked read ${result.marked.length > 0 ? result.marked.join(', ') : 'nothing'}`];
  if (result.refused.length > 0) {
    parts.push(`refused ${keyList(result.refused)}`);
  }
  if (result.skipped.length > 0) {
    parts.push(`skipped ${keyList(result.skipped)}`);
  }
  if (result.writesLocked) {
    parts.push('GitHub writes locked: pending after the undo window');
  }
  return parts.join('; ');
}

/** Whether one PR of a mark_read call is marked, refused or skipped. */
export function agentMarkReadCheck(input: AgentMarkReadInput): AgentMarkReadCheck {
  if (!input.stored) {
    return { kind: 'refused', reason: 'PostPile does not track this PR' };
  }
  if (input.seenThrough === null || input.seenThrough.seq > input.newestSeq) {
    return { kind: 'refused', reason: 'this seen_through is not one pr_context printed for this PR; read it with pr_context(detail: "full") and pass its seen_through' };
  }
  if (input.newer.length > 0) {
    return { kind: 'refused', reason: newActivityReason(input.newer) };
  }
  if (input.snapshotBehind) {
    return { kind: 'refused', reason: 'PostPile has newer activity than it fetched; call refresh_from_github, then read it again' };
  }
  // Skips before the unread-list check: they mark nothing, and a retry after a mark changed that list itself.
  if (input.alreadyQueued) {
    return { kind: 'skipped', reason: 'already queued to mark read' };
  }
  if (!input.tracked) {
    return { kind: 'skipped', reason: 'a stack layer PostPile only shows for context: it has no notification of its own to mark read' };
  }
  if (!input.changesAnything) {
    return { kind: 'skipped', reason: 'already read' };
  }
  if (input.unreadHashNow !== input.seenThrough.unreadHash) {
    return { kind: 'refused', reason: 'the unread list changed since you read it; read it again' };
  }
  return { kind: 'mark' };
}
