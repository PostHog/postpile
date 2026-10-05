// The detail pane's Approve button: its label, its look and the small state
// glyphs in front of the label. Pure, so the rules stay tested and the
// review row stays dumb.
import type { PaneReview, PrLifecycle, PrPaneView, ViewerApproval } from '@postpile/core';
import type { EventGlyph } from './events.ts';
import { approvedText, capitalize } from './pr.ts';

export interface ApproveButtonInput {
  isDraft: boolean;
  /** Null before the first sync stored the viewer; every approval then counts as someone else's. */
  viewerLogin: string | null;
  reviews: PaneReview[];
  /** The viewer's standing approval from core (`PrDetail.viewerApproval`): app record or GitHub, any commit. */
  approval: ViewerApproval | null;
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

function othersApproved(input: ApproveButtonInput): boolean {
  return input.reviews.some((review) => review.state === 'APPROVED' && review.author !== input.viewerLogin);
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
 * - "Approve as well" when others approved and the viewer never did. An
 *   agent's approval counts here too, like on GitHub.
 * - Else "Approve".
 */
export function approveButton(input: ApproveButtonInput): ApproveButtonLook {
  const approval = input.approval;
  if (approval) {
    const commit = approval.commitOid;
    return { label: 'Approve again', variant: 'secondary', viewerApproved: true, headMoved: commit !== null && commit !== input.headOid };
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

const REVIEW_GLYPHS: Record<PrPaneView['reviewDecision'], StateGlyph | null> = {
  APPROVED: { glyph: 'check', title: 'Approved' },
  CHANGES_REQUESTED: { glyph: 'changes', title: 'Changes requested' },
  REVIEW_REQUIRED: { glyph: 'eye', title: 'Review required' },
  NONE: null,
};

/**
 * What the viewer approves into: the lifecycle glyph, then the review state
 * when the repo has a review rule. Unlike the status pill, drafts keep their
 * review glyph here, so "Approve draft" still shows existing approvals.
 * `agentApprovers` (`PrDetail.agentApprovers`) names the agents in the
 * tooltip when only agents approved.
 */
export function approveStateGlyphs(lifecycle: PrLifecycle, reviewDecision: PrPaneView['reviewDecision'], agentApprovers: string[]): StateGlyph[] {
  const glyphs = [LIFECYCLE_GLYPHS[lifecycle]];
  const review = REVIEW_GLYPHS[reviewDecision];
  if (review && reviewDecision === 'APPROVED' && agentApprovers.length > 0) {
    glyphs.push({ glyph: review.glyph, title: capitalize(approvedText(agentApprovers)) });
  } else if (review) {
    glyphs.push(review);
  }
  return glyphs;
}
