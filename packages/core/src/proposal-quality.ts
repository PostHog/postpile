import type { RuleProposal } from './memory.ts';
import type { Feedback, FeedbackKind, TopicProposal } from './types.ts';

// The bar a consolidation proposal has to clear before it interrupts the
// user (DESIGN.md "Consolidation", decided 2026-10-02: proposals must earn
// their interruption). Every check here is deterministic; the prompt asks
// for the same, these catch what slips through.

/** A reason shorter than this says nothing the user can act on. */
export const MIN_REASON_CHARS = 15;

/** Reasons that are filler, compared after lowercasing and trimming punctuation. */
const PLACEHOLDER_REASONS = new Set(['placeholder', 'tbd', 'tba', 'todo', 'n/a', 'na', 'none', 'reason', 'no reason', 'same', 'see above', 'test', 'xxx', 'lorem ipsum']);

function plainReason(reason: string): string {
  return reason
    .trim()
    .toLowerCase()
    .replace(/^[\s"'`.\-–—:]+|[\s"'`.!?\-–—:]+$/g, '')
    .replace(/\s+/g, ' ');
}

/** Empty, too short to say anything, or a placeholder: such a proposal is dropped. */
export function isJunkReason(reason: string): boolean {
  const plain = plainReason(reason);
  if (plain.length < MIN_REASON_CHARS) {
    return true;
  }
  return PLACEHOLDER_REASONS.has(plain) || plain.includes('placeholder') || plain.includes('lorem ipsum');
}

/** Size or lifecycle words: what a merge reason may mention, but never rest on. */
const SIZE_OR_STATE = /\b(small|tiny|single[- ]pr|one[- ]pr|few prs|finished|winding[- ]down|wound[- ]down|done|all (?:their |the )?prs? (?:are )?merged|nothing open|no open prs?|inactive|stale)\b/;

/** Words that name what the PRs share: a goal, a series, a dependency. "same" only with what is shared ("the same rollout"), never "the same finished state". */
const SHARED_WORK = /\b(same (?:\w+ )?(?:goal|project|rollout|series|initiative|feature|migration|effort|work|change|rules|stack|plan)|serve|serves|serving|goal|together|part of|series|rollout|layer|stack|blocker|blocks|blocked|depends|follow[- ]up|continues|one project|single project|overlap|overlaps|duplicate|split from)\b/;

/**
 * A merge reason that rests on size or lifecycle alone ("Both topics are
 * small and finished"): no word says what the PRs share. Finished topics
 * are retirement's job, and two small topics are not one goal.
 */
export function isSizeOrStateOnlyMergeReason(reason: string): boolean {
  const plain = plainReason(reason);
  return SIZE_OR_STATE.test(plain) && !SHARED_WORK.test(plain);
}

/**
 * What a feedback row says about the user's wishes:
 * - words: the note holds a line the user wrote, kept or asked to forget.
 * - click: a button ("Not mine", "Wrong topic"); it moves one PR and says
 *   nothing about why, unless the user typed a note.
 * - event: the note is GitHub text the app filled in, not the user's words.
 */
const FEEDBACK_VOICE: Record<FeedbackKind, 'words' | 'click' | 'event'> = {
  not_mine: 'click',
  not_related: 'click',
  wrong_topic: 'click',
  unmute: 'event',
  tailoring_kept: 'words',
  tailoring_once: 'words',
  memory_wrong: 'words',
  memory_forget: 'words',
  memory_confirmed: 'words',
  memory_fixed: 'words',
  work_context_forget: 'words',
};

/** True when the row states a preference in words: a worded kind, or a click with a note the user typed. */
export function feedbackStatesPreference(feedback: Pick<Feedback, 'kind' | 'note'>): boolean {
  const voice = FEEDBACK_VOICE[feedback.kind];
  if (voice === 'words') {
    return true;
  }
  return voice === 'click' && feedback.note.trim() !== '';
}

/**
 * A rule needs at least one cited correction that says what the user wants.
 * Bare clicks are evidence for moving PRs, not grounds for a standing rule.
 */
export function ruleHasWordedEvidence(evidenceIds: number[], feedback: Pick<Feedback, 'id' | 'kind' | 'note'>[]): boolean {
  const cited = new Set(evidenceIds);
  return feedback.some((row) => cited.has(row.id) && feedbackStatesPreference(row));
}

/** Rule text compared for repeats: case, spacing and closing punctuation aside. */
export function ruleTextKey(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[\s.!]+$/, '');
}

export type TopicChangeShape = Pick<TopicProposal, 'kind' | 'topicId' | 'intoTopicId' | 'name' | 'fromArea' | 'prKeys'>;

/** A topic name compared for repeats: case and spacing aside. */
function nameKey(name: string | null): string {
  return (name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function samePair(a1: string | null, a2: string | null, b1: string | null, b2: string | null): boolean {
  return (a1 === b1 && a2 === b2) || (a1 === b2 && a2 === b1);
}

/**
 * The same change in spirit, whatever the wording: a merge of the same two
 * topics in either direction, the same two areas folded either way, a
 * rename of the same topic to the same name, a split of the same topic that
 * moves one of the same PRs. A rejected rename only rules out that name: the
 * topic may change enough to deserve another one.
 */
function sameChangeAnyDirection(change: TopicChangeShape, filed: TopicChangeShape): boolean {
  if (change.kind !== filed.kind) {
    return false;
  }
  if (change.kind === 'merge') {
    return samePair(change.topicId, change.intoTopicId, filed.topicId, filed.intoTopicId);
  }
  if (change.kind === 'area_merge') {
    return samePair(change.fromArea, change.name, filed.fromArea, filed.name);
  }
  if (change.topicId !== filed.topicId) {
    return false;
  }
  if (change.kind === 'split') {
    return change.prKeys.some((key) => filed.prKeys.includes(key));
  }
  return change.kind === 'rename' && nameKey(change.name) === nameKey(filed.name);
}

/** The user rejected an equivalent change before: don't ask again. */
export function repeatsRejectedChange(change: TopicChangeShape, filed: (TopicChangeShape & Pick<TopicProposal, 'status'>)[]): boolean {
  return filed.some((proposal) => proposal.status === 'rejected' && sameChangeAnyDirection(change, proposal));
}

/**
 * Pending topic proposals that name a topic no longer active (retired,
 * archived or gone): nothing the user could still accept. They get
 * withdrawn, which never counts as the user's no.
 */
export function staleTopicProposalIds(pending: TopicProposal[], isActive: (topicId: string) => boolean): string[] {
  return pending
    .filter((proposal) => [proposal.topicId, proposal.intoTopicId].some((id) => id !== null && !isActive(id)))
    .map((proposal) => proposal.id);
}

/** Pending rule proposals scoped to a topic no longer active. Global rules never go stale. */
export function staleRuleProposalIds(pending: RuleProposal[], isActive: (topicId: string) => boolean): string[] {
  return pending.filter((rule) => rule.topicId !== null && !isActive(rule.topicId)).map((rule) => rule.id);
}
