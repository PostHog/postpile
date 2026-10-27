// An agent approver's decline (DESIGN.md "An agent approver's decline").
// An author asks stamphog for a review with its label when they see the
// change as small and low-risk and want it in soon. When stamphog says no,
// a person has to look, often a named team. Read from stamphog's latest
// verdict review by rules, no agent call. Pure, from the PR snapshot.
import { standingApprovals } from './approvals.ts';
import { TRIMMED_MARKER } from './bot-bodies.ts';
import { STAMPHOG_LOGIN } from './bots.ts';
import { stripHtmlComments } from './html-comments.ts';
import type { Pr, Review } from './types.ts';

/** The longest reason kept, in characters, "…" included. */
export const DECLINE_REASON_MAX = 300;

/**
 * Why it declined: it asks for a person to review (needs_person), it handed
 * the PR on to a person (escalated), or a gate (size, tier, deny-list) puts
 * the change outside what it may auto-approve (gates).
 */
export type AgentDeclineKind = 'needs_person' | 'escalated' | 'gates';

export interface AgentDecline {
  /** The agent's name without "[bot]": "stamphog". */
  agent: string;
  kind: AgentDeclineKind;
  /** The verdict's prose, without the gate table, whitespace collapsed and clipped to DECLINE_REASON_MAX. GitHub text. */
  reason: string;
  /** When the verdict review was submitted. */
  at: string;
  /** The head commit the verdict was made on; null when GitHub did not say. */
  commitOid: string | null;
}

/**
 * What a verdict review says: approved, declined (with its kind), waiting
 * on prerequisites, or unknown (a cut body whose gate table is gone).
 */
type Verdict = { kind: 'approved' } | { kind: 'waiting' } | { kind: 'unknown' } | { kind: 'declined'; decline: AgentDeclineKind };

/** Cut on save before stamphog bodies were kept whole (`trimBotBody`): the end, with the gate table, is gone. */
function isTrimmed(body: string): boolean {
  return body.endsWith(TRIMMED_MARKER);
}

/** The first line with text, trimmed. */
function firstLine(body: string): string {
  return body.split('\n').find((line) => line.trim() !== '')?.trim() ?? '';
}

/** Gate names in the gate table whose result column is a cross: "| size | ✗ | too large |" -> "size". */
function failedGates(body: string): string[] {
  const gates: string[] = [];
  for (const line of body.split('\n')) {
    const cells = line.trim().split('|').map((cell) => cell.trim());
    // "| gate | result | detail |" splits into ['', gate, result, detail, ''].
    if (cells.length >= 4 && cells[0] === '' && /^[✗✘❌]$/u.test(cells[2] ?? '')) {
      gates.push((cells[1] ?? '').toLowerCase());
    }
  }
  return gates;
}

/**
 * Reads the bold first line. Matches the "Not approved" prefix, not the full
 * sentence, so small wording changes keep working. "Not approved yet" waits
 * on prerequisites (merge conflicts, changes requested) unless the gate
 * table fails another gate: then stamphog will not auto-review it at all.
 * A cut body without a failed gate in what is left is unknown, not
 * waiting: the gate that failed may sit past the cut.
 * Null when the body is no verdict.
 */
function readVerdict(body: string): Verdict | null {
  const line = firstLine(body).toLowerCase();
  if (line.startsWith('**approved')) {
    return { kind: 'approved' };
  }
  if (line.startsWith('**not approved yet')) {
    const otherGate = failedGates(body).some((gate) => gate !== 'prerequisites');
    if (otherGate) {
      return { kind: 'declined', decline: 'gates' };
    }
    return isTrimmed(body) ? { kind: 'unknown' } : { kind: 'waiting' };
  }
  if (line.startsWith('**not approved')) {
    return { kind: 'declined', decline: line.includes('escalat') ? 'escalated' : 'needs_person' };
  }
  return null;
}

/** The text without the <details> blocks (the gate table); an unclosed one hides the rest. */
function withoutDetails(text: string): string {
  let result = '';
  let from = 0;
  const lower = text.toLowerCase();
  for (;;) {
    const open = lower.indexOf('<details', from);
    if (open === -1) {
      return result + text.slice(from);
    }
    result += text.slice(from, open);
    const close = lower.indexOf('</details>', open);
    if (close === -1) {
      return result;
    }
    from = close + '</details>'.length;
  }
}

/** Cut at a word boundary to `max` characters with "…". */
function clipped(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * The prose after the "Re-add the `stamphog` label" line (else after the
 * bold first line), without the cut marker, the gate details and HTML comments, bold marks
 * dropped, whitespace collapsed, clipped.
 */
function declineReason(body: string): string {
  const whole = isTrimmed(body) ? body.slice(0, -TRIMMED_MARKER.length) : body;
  const lines = stripHtmlComments(withoutDetails(whole)).split('\n');
  const readd = lines.findIndex((line) => /re-?add the `?stamphog`? label/i.test(line));
  const start = readd >= 0 ? readd + 1 : lines.findIndex((line) => line.trim() !== '') + 1;
  const prose = lines.slice(start).join(' ').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
  return clipped(prose, DECLINE_REASON_MAX);
}

/** The verdict body of a stamphog review: its own body, else the review comment with its id (`normalize.ts` stores both). */
function verdictBody(pr: Pr, review: Review): string | null {
  if (review.body !== null && review.body.trim() !== '') {
    return review.body;
  }
  return pr.comments.find((comment) => comment.kind === 'review' && comment.id === review.id)?.body ?? null;
}

/**
 * stamphog's latest verdict as a decline, else null. Only verdict reviews
 * count (a body that starts with "**Approved" or "**Not approved"); its
 * plain status comments never do. A later approval cancels an earlier
 * decline, also one a push dismissed since. An unknown latest verdict
 * (`readVerdict`) shows no decline until the PR is fetched again
 * (`hasTrimmedAgentVerdict`). Null on merged and closed
 * PRs, and once a person approved: the decline no longer stands between
 * the PR and a merge.
 */
export function agentDecline(pr: Pr): AgentDecline | null {
  if (pr.state !== 'OPEN') {
    return null;
  }
  if (standingApprovals(pr).people.length > 0) {
    return null;
  }
  const newestFirst = pr.reviews
    .filter((review) => review.author === STAMPHOG_LOGIN && review.state !== 'PENDING')
    .sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1));
  for (const review of newestFirst) {
    // An approval counts even when its body says nothing we know.
    if (review.state === 'APPROVED') {
      return null;
    }
    const body = verdictBody(pr, review);
    const verdict = body === null ? null : readVerdict(body);
    if (verdict === null) {
      continue;
    }
    if (body === null || verdict.kind !== 'declined') {
      return null;
    }
    return { agent: 'stamphog', kind: verdict.decline, reason: declineReason(body), at: review.submittedAt, commitOid: review.commitOid };
  }
  return null;
}

/** What the tile and the detail pane get of a decline: the renderer never imports the rule. */
export interface AgentDeclineView {
  agent: string;
  kind: AgentDeclineKind;
  reason: string;
  /** The verdict was made on a commit that is no longer the head. */
  earlierCommit: boolean;
}

/** `agentDecline` as view data, null when there is none. */
export function agentDeclineView(pr: Pr): AgentDeclineView | null {
  const decline = agentDecline(pr);
  if (decline === null) {
    return null;
  }
  return {
    agent: decline.agent,
    kind: decline.kind,
    reason: decline.reason,
    earlierCommit: decline.commitOid !== null && decline.commitOid !== pr.headOid,
  };
}

/**
 * An open PR with a stamphog review body that was cut on save before its
 * bodies were kept whole (2026-10-27). The gate table may be gone, so the
 * freshness check fetches the PR once more; the new copy is stored whole,
 * so this turns false after that fetch.
 */
export function hasTrimmedAgentVerdict(pr: Pr): boolean {
  if (pr.state !== 'OPEN') {
    return false;
  }
  return pr.comments.some((comment) => comment.author === STAMPHOG_LOGIN && comment.kind === 'review' && comment.body !== null && isTrimmed(comment.body));
}
