// Words for the ✨ agent-assisted buttons. Core decides every offer (state,
// risk, reason, counts); this only spells them out.
import type { AgentApproveOffer, MarkReadBlock, SkippedTile, TileKind, TopicMarkReadOffer } from '@postpile/core';

/** Pill words for a greyed action: why the agent cannot back it. */
const REASON_WORDS: Record<MarkReadBlock, string> = {
  rechecking: 'Rechecking…',
  look_closer: 'Look closer',
  high: 'High risk',
  asks_for_you: 'Needs you',
};

/** The same reasons inside the batch toast's sentence. */
const SKIP_WORDS: Record<MarkReadBlock, string> = {
  rechecking: 'rechecking',
  look_closer: 'look closer',
  high: 'high risk',
  asks_for_you: 'asks for you',
};

const REASON_SENTENCES: Record<MarkReadBlock, string> = {
  rechecking: 'A PR changed since the agent looked, and it is checking again.',
  look_closer: 'The agent says at least one PR needs a closer look.',
  high: 'The agent rates the risk of at least one PR as high.',
  asks_for_you: 'Something in the unread news asks for you.',
};

const RISK_WORDS = { low: 'Low risk', medium: 'Medium risk' } as const;

/** The words in the approve pill: the risk of an active offer, or why a greyed one is greyed. */
export function approvePillWord(offer: AgentApproveOffer): string {
  if (offer.state === 'active' && offer.risk) {
    return RISK_WORDS[offer.risk];
  }
  return offer.reason ? REASON_WORDS[offer.reason] : '';
}

/** The words in the topic Mark read pill: no ask for you when active, else why it is greyed. */
export function markReadPillWord(offer: TopicMarkReadOffer): string {
  if (offer.state === 'active') {
    return 'No ask for you';
  }
  return offer.reason ? REASON_WORDS[offer.reason] : '';
}

/** The topic's label: "Approve 3 of 5 PRs", "Approve 3 PRs" when all qualify, plain "Approve" when greyed. */
export function topicApproveLabel(offer: AgentApproveOffer): string {
  if (offer.state === 'greyed') {
    return 'Approve';
  }
  const prs = offer.coveredCount === offer.totalCount ? `${offer.coveredCount}` : `${offer.coveredCount} of ${offer.totalCount}`;
  return `Approve ${prs} ${offer.totalCount === 1 ? 'PR' : 'PRs'}`;
}

/** The tile's label: "Approve", "Approve stack", "Approve 3 PRs" on a set. Greyed keeps the plain base. */
export function tileApproveLabel(offer: AgentApproveOffer, kind: TileKind): string {
  if (kind === 'stack') {
    return 'Approve stack';
  }
  return kind === 'set' && offer.state === 'active' ? `Approve ${offer.coveredCount} PRs` : 'Approve';
}

export function topicMarkReadLabel(offer: TopicMarkReadOffer): string {
  return offer.state === 'active' ? `Mark ${offer.coveredCount} read` : 'Mark read';
}

/** One sentence for the button's tooltip: what a click does, or why it is greyed. */
export function approveTitle(offer: AgentApproveOffer): string {
  if (offer.state === 'greyed' && offer.reason) {
    return `Greyed out: ${REASON_SENTENCES[offer.reason]} Open the PR to approve it yourself.`;
  }
  return 'Agent verdict: Looks safe.';
}

export function topicMarkReadTitle(offer: TopicMarkReadOffer): string {
  if (offer.state === 'greyed' && offer.reason) {
    return `Greyed out: ${REASON_SENTENCES[offer.reason]}`;
  }
  return 'The agent found no ask for you in these unread tiles. Other tiles stay unread.';
}

/** "Marked 3 read · 1 skipped (asks for you)". */
export function batchMarkReadMessage(count: number, skipped: SkippedTile[], serverMessage: string, writesOn: boolean): string {
  const base = writesOn ? `Marked ${count} read` : serverMessage;
  if (skipped.length === 0) {
    return base;
  }
  const reasons = [...new Set(skipped.map((tile) => SKIP_WORDS[tile.reason]))];
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
