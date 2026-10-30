// stamphog's verdict in MCP answers (DESIGN.md "An agent approver's
// decline" › In MCP answers): a short mention on list lines, a few lines in
// pr_context, and the same as JSON. Words and the author hint by rules from
// core's `AgentVerdictView`, no agent call. Gate names and the reason are
// GitHub text: inside the fence in text, under "untrusted" in JSON.
import type { AgentDeclineKind, AgentVerdictView } from '@postpile/core';
import { day } from './text.ts';

const DECLINE_WORDS: Record<AgentDeclineKind, string> = {
  needs_person: 'needs a person to review',
  escalated: 'escalated to a person',
  gates: 'outside what it may auto-approve',
};

/** What the author can do next: ask a person, or re-add the label to re-run it on the new head. */
export type AuthorCan = 'ask_person' | 'readd_label';

/**
 * Declined on an older head: re-adding the label re-runs it on the new
 * head. Declined on the head: re-adding it gives the same answer while
 * nothing changes, so a person has to review. An approval asks nothing.
 */
export function authorCan(verdict: AgentVerdictView): AuthorCan | null {
  if (verdict.verdict === 'approved') {
    return null;
  }
  return verdict.olderHead ? 'readd_label' : 'ask_person';
}

/** "stamphog declined: outside what it may auto-approve (failed: size, tier)", "stamphog approved"; ", on an older head" when the head moved since. */
export function agentVerdictShort(verdict: AgentVerdictView): string {
  const older = verdict.olderHead ? ', on an older head' : '';
  if (verdict.verdict === 'approved') {
    return `${verdict.agent} approved${older}`;
  }
  const gates = verdict.failedGates.length > 0 ? ` (failed: ${verdict.failedGates.join(', ')})` : '';
  const kind = verdict.declineKind === null ? '' : `: ${DECLINE_WORDS[verdict.declineKind]}`;
  return `${verdict.agent} declined${kind}${gates}${older}`;
}

const AUTHOR_CAN_TEXT: Record<AuthorCan, string> = {
  readd_label: 'The verdict is on an older head: re-adding the `stamphog` label re-runs it on the current one.',
  ask_person: 'Re-adding the `stamphog` label gives the same result while nothing changes: ask a person to review.',
};

/** pr_context: the verdict, its reasons, and what the author can do. Empty without a verdict. */
export function agentVerdictLines(verdict: AgentVerdictView | null): string[] {
  if (verdict === null) {
    return [];
  }
  const lines = [`Agent approver: ${agentVerdictShort(verdict)} (${day(verdict.at)})`];
  if (verdict.reason !== '') {
    lines.push(`  Its reasons: ${verdict.reason}`);
  }
  const can = authorCan(verdict);
  if (can !== null) {
    lines.push(`  What the author can do: ${AUTHOR_CAN_TEXT[can]}`);
  }
  if (verdict.nobodyAsked) {
    lines.push("  Nobody is asked to review it: it waits on the author to ask a person. PostPile's move line does not count this.");
  }
  return lines;
}

export interface AgentVerdictJson {
  agent: string;
  verdict: 'approved' | 'declined';
  /** Why it declined; null on an approval. */
  declineKind: AgentDeclineKind | null;
  at: string;
  /** Made on a commit that is no longer the head. */
  olderHead: boolean;
  /** Declined and no person or team is asked to review: stuck until the author asks one. */
  nobodyAsked: boolean;
  authorCan: AuthorCan | null;
}

/** The verdict's facts; its GitHub text goes to `agentVerdictUntrusted`. */
export function agentVerdictJson(verdict: AgentVerdictView | null): AgentVerdictJson | null {
  if (verdict === null) {
    return null;
  }
  return {
    agent: verdict.agent,
    verdict: verdict.verdict,
    declineKind: verdict.declineKind,
    at: verdict.at,
    olderHead: verdict.olderHead,
    nobodyAsked: verdict.nobodyAsked,
    authorCan: authorCan(verdict),
  };
}

export function agentVerdictUntrusted(verdict: AgentVerdictView | null): { failedGates: string[]; reason: string } | null {
  return verdict === null ? null : { failedGates: verdict.failedGates, reason: verdict.reason };
}
