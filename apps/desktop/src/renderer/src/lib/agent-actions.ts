// Words for the ✨ agent-assisted buttons. Core decides every offer (state,
// risk, reason, counts); this only spells them out.
import type { AgentApproveOffer, MarkReadBlock, SkippedTile, TopicMarkReadOffer } from '@postpile/core';

const REASON_WORDS: Record<MarkReadBlock, string> = {
  rechecking: 'rechecking…',
  look_closer: 'look closer',
  high: 'high',
  asks_for_you: 'asks for you',
};

const REASON_SENTENCES: Record<MarkReadBlock, string> = {
  rechecking: 'A PR changed since the agent looked, and it is checking again.',
  look_closer: 'The agent says at least one PR needs a closer look.',
  high: 'The agent rates the risk of at least one PR as high.',
  asks_for_you: 'Something in the unread news asks for you.',
};

/** The words in the pill: the risk of an active offer, or why a greyed one is greyed. */
export function pillWord(offer: { state: 'active' | 'greyed'; risk: 'low' | 'medium' | null; reason: MarkReadBlock | null }): string {
  if (offer.state === 'active' && offer.risk) {
    return offer.risk;
  }
  return offer.reason ? REASON_WORDS[offer.reason] : '';
}

/** "Approve 3 of 5 PRs", or "Approve 3 PRs" when every approvable PR qualifies. */
export function topicApproveLabel(offer: AgentApproveOffer): string {
  const prs = offer.coveredCount === offer.totalCount ? `${offer.coveredCount}` : `${offer.coveredCount} of ${offer.totalCount}`;
  return `Approve ${prs} ${offer.totalCount === 1 ? 'PR' : 'PRs'}`;
}

export function topicMarkReadLabel(offer: TopicMarkReadOffer): string {
  return offer.coveredCount === 0 ? 'Mark read' : `Mark ${offer.coveredCount} read`;
}

/** One sentence for the button's tooltip: what a click does, or why it is greyed. */
export function approveTitle(offer: AgentApproveOffer, what: 'tile' | 'topic'): string {
  if (offer.state === 'greyed' && offer.reason) {
    return `Greyed out: ${REASON_SENTENCES[offer.reason]} Open the PR to approve it yourself.`;
  }
  const where = what === 'tile' ? 'in this tile' : 'in this topic';
  return `Approves the ${offer.coveredCount === 1 ? 'PR' : 'PRs'} the agent judged safe ${where} on GitHub, after you confirm.`;
}

export function topicMarkReadTitle(offer: TopicMarkReadOffer): string {
  if (offer.state === 'greyed' && offer.reason) {
    return `Greyed out: ${REASON_SENTENCES[offer.reason]}`;
  }
  return 'Marks the tiles the agent judged safe read; tiles that ask for you stay unread.';
}

/** "Marked 3 read · 1 skipped (asks for you)". */
export function batchMarkReadMessage(count: number, skipped: SkippedTile[], serverMessage: string, writesOn: boolean): string {
  const base = writesOn ? `Marked ${count} read` : serverMessage;
  if (skipped.length === 0) {
    return base;
  }
  const reasons = [...new Set(skipped.map((tile) => REASON_WORDS[tile.reason].replace('…', '')))];
  return `${base} · ${skipped.length} skipped (${reasons.join(', ')})`;
}

export function approvedMessage(count: number): string {
  return count === 1 ? 'Approved' : `Approved ${count} PRs`;
}

const LEFT_OUT_WORDS = { rechecking: 'rechecking after a push', look_closer: 'look closer', high: 'high risk' } as const;

/** Why the confirm list names a PR as left out. */
export function leftOutReason(reason: keyof typeof LEFT_OUT_WORDS): string {
  return LEFT_OUT_WORDS[reason];
}
