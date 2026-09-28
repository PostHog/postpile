// The detail pane's Approve button: its label, its look and the small state
// glyphs in front of the label. Pure, so the rules stay tested and the
// ActionBar stays dumb.
import type { Pr, PrLifecycle, Review } from '@postpile/core';
import type { EventGlyph } from './events.ts';

export interface ApproveButtonInput {
  /** From core (`PrSummary.primaryAction`): approved = the viewer's approval covers the head. */
  primary: 'approve' | 'approved';
  isDraft: boolean;
  /** Null before the first sync stored the viewer; every approval then counts as someone else's. */
  viewerLogin: string | null;
  reviews: Review[];
  /** The app's own record of the viewer's approval (any commit). */
  viewerApprovedAt: string | null;
}

export interface ApproveButtonLook {
  label: string;
  /** Ink primary, or outlined secondary on drafts. */
  variant: 'primary' | 'secondary';
}

/** The viewer approved this PR at some point, on any commit (app or github.com). */
function viewerApprovedEver(input: ApproveButtonInput): boolean {
  if (input.viewerApprovedAt !== null) {
    return true;
  }
  return input.reviews.some((review) => review.state === 'APPROVED' && review.author === input.viewerLogin);
}

function othersApproved(input: ApproveButtonInput): boolean {
  return input.reviews.some((review) => review.state === 'APPROVED' && review.author !== input.viewerLogin);
}

/**
 * Label and look of the Approve button:
 *
 * - "Approved ✓" (ink, disabled by the caller) while the viewer's approval
 *   covers the head. Unchanged from before.
 * - "Approve draft", outlined, on a draft. Draft wins over "as well": that
 *   the PR is not ready yet is the bigger caveat, and the review glyph in
 *   front of the label already shows the other approvals.
 * - "Approve as well" when others approved and the viewer never did, on any
 *   commit. A viewer whose approval is for an older commit gets plain
 *   "Approve" (the "commits after your approval" event covers that case).
 * - Else "Approve".
 */
export function approveButton(input: ApproveButtonInput): ApproveButtonLook {
  if (input.primary === 'approved') {
    return { label: 'Approved ✓', variant: 'primary' };
  }
  if (input.isDraft) {
    return { label: 'Approve draft', variant: 'secondary' };
  }
  if (othersApproved(input) && !viewerApprovedEver(input)) {
    return { label: 'Approve as well', variant: 'primary' };
  }
  return { label: 'Approve', variant: 'primary' };
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
