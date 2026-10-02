import type { PrDetail } from '@postpile/core';
import { useActions } from '../api/actions.tsx';
import { useViewer } from '../api/viewer.ts';
import { approveButton, approveStateGlyphs, type ApproveButtonInput, type ApproveButtonLook } from '../lib/approve.ts';
import { ageLabel } from '../lib/time.ts';
import { useNow } from '../lib/use-now.ts';
import { Button } from './Button.tsx';
import { ComposeAnchor, type ComposeKind } from './ComposePopover.tsx';
import { ChatIcon, Glyph } from './icons.tsx';

/** What Approve does, why it is blocked, or that you already approved, for the hover title. */
function approveTitle(input: ApproveButtonInput, look: ApproveButtonLook, blocked: string | null, now: Date): string {
  const action = blocked ?? 'Approves on GitHub right away. Cannot be undone.';
  const approvedAt = input.approval?.at ?? null;
  if (!look.viewerApproved || !approvedAt) {
    return action;
  }
  const after = look.headMoved ? '; commits came after, but your approval still counts' : '';
  return `You already approved ${ageLabel(approvedAt, now)} ago${after}. Approving again is harmless. ${action}`;
}

const COMMENT_REVIEW_TITLE =
  'Posts a review with a comment only, no approval. It answers a review request (yours or your team\'s) without being ' +
  'the one who clears the PR for merging: branch protection does not count a comment review as an approval.';

interface ApproveButtonsProps {
  detail: PrDetail;
  /** Approve is the pane's lead: filled green. */
  leads: boolean;
  /** The compose popover open in the pane, if any. */
  compose: ComposeKind | null;
  onToggleCompose: (kind: ComposeKind) => void;
  onCloseCompose: () => void;
}

/**
 * The PR pane's split Approve and "Comment review". The main part approves
 * right away without a note; the speech-bubble segment opens "Approve with
 * comment". Comment review sits next to it, outlined, never the lead. Both
 * notes are drafted by the agent in the compose popover under the buttons.
 */
export function ApproveButtons(props: ApproveButtonsProps) {
  const actions = useActions();
  const now = useNow();
  const viewer = useViewer();
  const { pr } = props.detail;
  const input: ApproveButtonInput = {
    isDraft: pr.isDraft,
    viewerLogin: viewer.data?.login ?? null,
    reviews: pr.reviews,
    approval: props.detail.viewerApproval,
    headOid: pr.headOid,
  };
  const look = approveButton(input);
  // The click shows the approval right away (lib/optimistic.ts); until the server confirmed, the button just says so.
  const approving = actions.isBusy(`approve:${pr.key}`);
  // Approve leads in green (--safe), the colour of the "Approved" state it produces.
  const variant = props.leads ? 'safe' : 'secondary';
  // A locked lock blocks the notes before the agent drafts one that cannot be sent.
  const approveBlocked = actions.blockedReason('approve');
  const reviewBlocked = actions.blockedReason('commentReview');
  return (
    <ComposeAnchor compose={props.compose} kinds={['approve', 'comment']} prKey={pr.key} headOid={pr.headOid} onClose={props.onCloseCompose}>
      <div className="flex">
        <Button
          variant={variant}
          size="md"
          className="rounded-r-none"
          disabled={approving}
          title={approveTitle(input, look, approveBlocked, now)}
          onClick={() => void actions.approve(pr.key, pr.headOid)}
        >
          {/* What you approve into: lifecycle, then review state; words in each glyph's tooltip. */}
          <span className="mr-px flex items-center gap-[3px] opacity-75">
            {approveStateGlyphs(props.detail.status.lifecycle, pr.reviewDecision, props.detail.agentApprovers).map((part) => (
              <span key={part.glyph} role="img" aria-label={part.title} title={part.title} className="flex">
                <Glyph glyph={part.glyph} size={11} strokeWidth={1.8} />
              </span>
            ))}
          </span>
          {approving ? (look.viewerApproved ? 'Approved' : 'Approving…') : look.label}
        </Button>
        <Button
          variant={variant}
          size="md"
          // The seam: a light line on green, the outlines overlapping by a pixel on the outlined look.
          className={`rounded-l-none px-2 ${variant === 'safe' ? 'border-l border-on-ink/30' : '-ml-px'}`}
          disabled={approving || approveBlocked !== null}
          aria-label="Approve with comment"
          aria-expanded={props.compose === 'approve'}
          title={approveBlocked ?? 'Approve with comment: the agent drafts a short review note you edit first'}
          onClick={() => props.onToggleCompose('approve')}
        >
          <ChatIcon />
        </Button>
      </div>
      <Button
        size="md"
        disabled={reviewBlocked !== null || actions.isBusy(`commentReview:${pr.key}`)}
        aria-expanded={props.compose === 'comment'}
        title={reviewBlocked ?? COMMENT_REVIEW_TITLE}
        onClick={() => props.onToggleCompose('comment')}
      >
        Comment review
      </Button>
    </ComposeAnchor>
  );
}
