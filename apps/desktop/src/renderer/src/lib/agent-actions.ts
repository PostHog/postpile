// Words for the ✨ agent-assisted buttons. Core decides every offer (state,
// risk, reason, counts); this only spells them out.
import type { AgentApproveOffer, LeftOutPr, MarkReadBlock, PrKey, SkippedTile, TileKind, TopicMarkReadOffer } from '@postpile/core';

/** Pill words for a greyed action: why the agent cannot back it. */
const REASON_WORDS: Record<MarkReadBlock, string> = {
  rechecking: 'Checking…',
  agent_off: 'No verdict',
  agent_limit: 'No verdict',
  glance_failed: 'No verdict',
  look_closer: 'Look closer',
  high: 'High risk',
  asks_for_you: 'Needs you',
};

/** The same reasons inside the batch toast's sentence. */
const SKIP_WORDS: Record<MarkReadBlock, string> = {
  rechecking: 'checking',
  agent_off: 'agent off',
  agent_limit: 'agent limit',
  glance_failed: 'glance failed',
  look_closer: 'look closer',
  high: 'high risk',
  asks_for_you: 'asks for you',
};

const REASON_SENTENCES: Record<MarkReadBlock, string> = {
  rechecking: 'A PR changed since the agent looked, or it has not looked yet. A new glance is on its way.',
  agent_off: 'Agent features are off or paused, so at least one PR has no current verdict.',
  agent_limit: 'The agent hit its call limit, so at least one PR has no current verdict until the next sync.',
  glance_failed: "The agent's glance failed on at least one PR, so it has no verdict.",
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

/** "#2107" from "acme/app#2107". */
function prNumber(prKey: PrKey): string {
  return prKey.slice(prKey.lastIndexOf('#'));
}

/** "Approve 3 of 5 PRs", or "Approve 3 PRs" when it covers every approvable PR. */
function countLabel(offer: AgentApproveOffer): string {
  const prs = offer.coveredCount === offer.totalCount ? `${offer.coveredCount}` : `${offer.coveredCount} of ${offer.totalCount}`;
  return `Approve ${prs} ${offer.totalCount === 1 ? 'PR' : 'PRs'}`;
}

/** The PR an offer names alone (`naming` one): "Approve #2107". */
function oneLabel(offer: AgentApproveOffer): string {
  const pr = offer.covered[0];
  return pr ? `Approve ${prNumber(pr.prKey)}` : 'Approve';
}

/** The topic's label: "Approve #2107" for one of several, else "Approve 3 of 5 PRs", "Approve 3 PRs"; plain "Approve" when greyed. */
export function topicApproveLabel(offer: AgentApproveOffer): string {
  if (offer.naming === 'none') {
    return 'Approve';
  }
  if (offer.naming === 'one') {
    return oneLabel(offer);
  }
  return countLabel(offer);
}

/**
 * The tile's label, by core's `naming`: "Approve #2107" for one of
 * several; "Approve", "Approve stack" or "Approve 3 PRs" on a set when it
 * covers every PR on the tile; else "Approve 2 of 3 PRs" (or "Approve 2
 * PRs" when a draft or pulled-in layer is all it leaves). Greyed is plain.
 */
export function tileApproveLabel(offer: AgentApproveOffer, kind: TileKind): string {
  if (offer.naming === 'none') {
    return 'Approve';
  }
  if (offer.naming === 'one') {
    return oneLabel(offer);
  }
  if (offer.naming === 'every' && kind === 'stack') {
    return 'Approve stack';
  }
  if (offer.naming === 'every' && kind === 'single') {
    return 'Approve';
  }
  return countLabel(offer);
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

/** Whether the ✨ Approve takes a click, whether it shows greyed, and its tooltip. */
export interface AgentApproveLook {
  usable: boolean;
  greyed: boolean;
  title: string;
}

/**
 * The ✨ Approve of a tile or topic. Greyed and disabled when the agent cannot
 * back it, and also while GitHub writes are locked, with the lock reason as its
 * tooltip, like the pane's Approve (2026-10-11): an approval has no pending
 * queue, so a click could only fail.
 */
export function agentApproveLook(offer: AgentApproveOffer, blocked: string | null): AgentApproveLook {
  if (blocked !== null) {
    return { usable: false, greyed: true, title: blocked };
  }
  const active = offer.state === 'active';
  return { usable: active, greyed: !active, title: approveTitle(offer) };
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

const LEFT_OUT_WORDS = {
  rechecking: 'checking after a change',
  agent_off: 'no verdict, agent off',
  agent_limit: 'no verdict, agent limit',
  glance_failed: 'no verdict, glance failed',
  look_closer: 'look closer', high: 'high risk', layer_below: 'a layer below needs a look' } as const;

/** Why the confirm list names a PR as left out: "look closer", or "waits on #2104" when a layer below holds it back. */
export function leftOutReason(pr: Pick<LeftOutPr, 'reason' | 'waitsOn'>): string {
  if (pr.reason === 'layer_below' && pr.waitsOn) {
    return `waits on ${prNumber(pr.waitsOn)}`;
  }
  return LEFT_OUT_WORDS[pr.reason];
}
