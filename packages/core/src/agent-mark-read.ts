import type { IsoTime, PrEvent, PrKey } from './types.ts';

// mark_read from an outside agent (DESIGN.md "Agents mark read"): the agent
// marks PRs read that it read in full with pr_context, through the running
// app, with the same queue, undo and writes lock as the pane's Mark read.
// The guard: a PR with activity PostPile stored after the agent's read is
// refused, so an agent never marks read what it did not see.

/** mark_read takes at most this many PRs per call. */
export const AGENT_MARK_READ_MAX_PRS = 20;

/**
 * One PR to mark read. `seenThrough` is the PR's newest event-log position
 * when the agent read it (`PrDetail.seenThrough`, printed by pr_context).
 */
export interface AgentMarkReadPr {
  prKey: PrKey;
  seenThrough: number;
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

/**
 * The app's toast for an agent's mark-read, with Undo while the window
 * runs. `id` grows, so the renderer shows each one once.
 */
export interface AgentReadNotice {
  id: number;
  /** The MCP client's name, e.g. "claude-code"; the renderer maps it to a display name. */
  client: string;
  prKeys: PrKey[];
  writesLocked: boolean;
  undoToken: string;
  undoUntil: IsoTime;
}

/** What the app knows about one PR of the request when it handles it. */
export interface AgentMarkReadInput {
  /** PostPile stores the PR. */
  stored: boolean;
  /** Some tile tracks it (pinged or found); false for a stack layer only pulled in for context. */
  tracked: boolean;
  seenThrough: number;
  /** The PR's newest event-log position now; 0 when it has no logged event. */
  newestSeq: number;
  /** The PR's events logged after seenThrough, oldest first. */
  newer: Pick<PrEvent, 'actor' | 'at'>[];
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
  if (input.seenThrough > input.newestSeq) {
    return { kind: 'refused', reason: `seen_through ${input.seenThrough} is not one pr_context printed for this PR; read it with pr_context(detail: "full") and pass its seen_through` };
  }
  if (input.newer.length > 0) {
    return { kind: 'refused', reason: newActivityReason(input.newer) };
  }
  if (!input.tracked) {
    return { kind: 'skipped', reason: 'a stack layer PostPile only shows for context: it has no notification of its own to mark read' };
  }
  if (!input.changesAnything) {
    return { kind: 'skipped', reason: 'already read' };
  }
  return { kind: 'mark' };
}
