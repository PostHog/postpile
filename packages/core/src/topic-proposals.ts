import type { IsoTime, TopicProposal } from './types.ts';

// Topic proposals from outside agents (propose_topic_change, DESIGN.md "MCP
// server"): they expire after OUTSIDE_PROPOSAL_DAYS unanswered, and an agent
// may not file the same change twice. Expiry is derived from the date, never
// stored, so the read-only MCP process and the app agree without a job.

/** An outside agent's proposal left pending this long no longer counts. */
export const OUTSIDE_PROPOSAL_DAYS = 14;

const DAY_MS = 24 * 3600_000;

/**
 * What became of a proposal; `expired` only for outside ones left pending
 * too long, `withdrawn` when a topic it names stopped being active.
 */
export type ProposalOutcome = 'pending' | 'accepted' | 'rejected' | 'withdrawn' | 'expired';

/** When an outside proposal expires; null for consolidation's, which wait for the user. */
export function proposalExpiresAt(proposal: TopicProposal): IsoTime | null {
  if (proposal.source !== 'agent') {
    return null;
  }
  return new Date(Date.parse(proposal.createdAt) + OUTSIDE_PROPOSAL_DAYS * DAY_MS).toISOString();
}

export function proposalOutcome(proposal: TopicProposal, now: IsoTime): ProposalOutcome {
  if (proposal.status !== 'pending') {
    return proposal.status;
  }
  const expiresAt = proposalExpiresAt(proposal);
  return expiresAt !== null && expiresAt <= now ? 'expired' : 'pending';
}

/** Pending and not expired: what the Inbox shows and the caps count. */
export function isLiveProposal(proposal: TopicProposal, now: IsoTime): boolean {
  return proposalOutcome(proposal, now) === 'pending';
}

/** When the outcome came: the decision time, the expiry time, or null while pending. */
export function proposalOutcomeAt(proposal: TopicProposal, now: IsoTime): IsoTime | null {
  const outcome = proposalOutcome(proposal, now);
  if (outcome === 'expired') {
    return proposalExpiresAt(proposal);
  }
  return outcome === 'pending' ? null : proposal.decidedAt;
}

function normalized(text: string | null): string {
  return (text ?? '').trim().toLowerCase();
}

type TopicChangeFields = Pick<TopicProposal, 'kind' | 'topicId' | 'name' | 'intoTopicId' | 'prKeys'>;

function samePrKeys(a: string[], b: string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((key) => right.has(key));
}

/**
 * The same change to the same topic: a merge into the same topic, a move of
 * the same PRs into the same topic, a rename or split to the same name
 * (case and spaces aside). Used to refuse an outside proposal that is
 * pending already or was rejected before.
 */
export function sameTopicChange(a: TopicChangeFields, b: TopicChangeFields): boolean {
  if (a.kind !== b.kind || a.topicId !== b.topicId) {
    return false;
  }
  if (a.kind === 'merge') {
    return a.intoTopicId === b.intoTopicId;
  }
  if (a.kind === 'move') {
    return a.intoTopicId === b.intoTopicId && samePrKeys(a.prKeys, b.prKeys);
  }
  return normalized(a.name) === normalized(b.name);
}
