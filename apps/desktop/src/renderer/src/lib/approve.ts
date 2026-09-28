// The detail pane's Approve button: its label, its look and the small state
// glyphs in front of the label. Pure, so the rules stay tested and the
// ActionBar stays dumb.
import type { Pr, PrLifecycle, Review } from '@postpile/core';
import type { EventGlyph } from './events.ts';

export interface ApproveButtonInput {
  isDraft: boolean;
  /** Null before the first sync stored the viewer; every approval then counts as someone else's. */
  viewerLogin: string | null;
  reviews: Review[];
  /** The app's own record of the viewer's approval (any commit). */
  viewerApprovedAt: string | null;
  /** Head commit at the app's approval, null when the app has no record. */
  viewerApprovedCommitOid: string | null;
  headOid: string;
}

export interface ApproveButtonLook {
  label: string;
  /** Ink primary, or outlined secondary (drafts, already approved). */
  variant: 'primary' | 'secondary';
  /** The viewer approved on some commit; the tooltip says so. */
  viewerApproved: boolean;
  /** Commits came after the viewer's approval (the head moved). */
  headMoved: boolean;
}

/** The viewer's newest approving review on GitHub, any commit. */
function viewerApproval(input: ApproveButtonInput): Review | null {
  let newest: Review | null = null;
  for (const review of input.reviews) {
    if (review.state === 'APPROVED' && review.author === input.viewerLogin && (!newest || review.submittedAt > newest.submittedAt)) {
      newest = review;
    }
  }
  return newest;
}

function othersApproved(input: ApproveButtonInput): boolean {
  return input.reviews.some((review) => review.state === 'APPROVED' && review.author !== input.viewerLogin);
}

/** The commit the viewer's approval was for: the app record first, else the newest review. Null when unknown. */
function approvedCommit(input: ApproveButtonInput, review: Review | null): string | null {
  return input.viewerApprovedCommitOid ?? review?.commitOid ?? null;
}

/**
 * Label and look of the Approve button. Approvals do not depend on the
 * commit (2026-09-28): an approval on any commit counts.
 *
 * - "Approve again", outlined, once the viewer approved (app record or a
 *   non-dismissed approving review, any commit). A harmless re-approve,
 *   never nagging; the tooltip says he approved and whether commits came
 *   after. Wins over draft: the viewer is done either way.
 * - "Approve draft", outlined, on a draft. Draft wins over "as well": that
 *   the PR is not ready yet is the bigger caveat, and the review glyph in
 *   front of the label already shows the other approvals.
 * - "Approve as well" when others approved and the viewer never did.
 * - Else "Approve".
 */
export function approveButton(input: ApproveButtonInput): ApproveButtonLook {
  const review = viewerApproval(input);
  const viewerApproved = input.viewerApprovedAt !== null || review !== null;
  if (viewerApproved) {
    const commit = approvedCommit(input, review);
    return { label: 'Approve again', variant: 'secondary', viewerApproved, headMoved: commit !== null && commit !== input.headOid };
  }
  const base = { viewerApproved: false, headMoved: false };
  if (input.isDraft) {
    return { label: 'Approve draft', variant: 'secondary', ...base };
  }
  if (othersApproved(input)) {
    return { label: 'Approve as well', variant: 'primary', ...base };
  }
  return { label: 'Approve', variant: 'primary', ...base };
}

/** The viewer's newest approval time: the app record or the newest approving review. */
export function viewerApprovedAt(input: ApproveButtonInput): string | null {
  return input.viewerApprovedAt ?? viewerApproval(input)?.submittedAt ?? null;
}

export interface StateGlyph {
  glyph: EventGlyph;
  /** In words, for the tooltip and screen readers. */
  title: string;
}

const LIFECYCLE_GLYPHS: Record<PrLifecycle, StateGlyph> = {
  draft: { glyph: 'draft', title: 'Draft: not ready for review yet' },
  open: { glyph: 'ready', title: 'Open and ready for review' },
  queued: { glyph: 'queue', title: 'In the merge queue' },
  merged: { glyph: 'merge', title: 'Merged' },
  closed: { glyph: 'closed', title: 'Closed without merge' },
};

const REVIEW_GLYPHS: Record<Pr['reviewDecision'], StateGlyph | null> = {
  APPROVED: { glyph: 'check', title: 'Approved' },
  CHANGES_REQUESTED: { glyph: 'changes', title: 'Changes requested' },
  REVIEW_REQUIRED: { glyph: 'eye', title: 'Review required' },
  NONE: null,
};

/**
 * What the viewer approves into: the lifecycle glyph, then the review state
 * when the repo has a review rule. Unlike the status pill, drafts keep their
 * review glyph here, so "Approve draft" still shows existing approvals.
 */
export function approveStateGlyphs(lifecycle: PrLifecycle, reviewDecision: Pr['reviewDecision']): StateGlyph[] {
  const glyphs = [LIFECYCLE_GLYPHS[lifecycle]];
  const review = REVIEW_GLYPHS[reviewDecision];
  if (review) {
    glyphs.push(review);
  }
  return glyphs;
}
