import type { PaneOffers, PrDetail } from '@postpile/core';
import { useActions } from '../api/actions.tsx';
import { useViewer } from '../api/viewer.ts';
import { approveButton, approveStateGlyphs, type ApproveButtonInput, type ApproveButtonLook } from '../lib/approve.ts';
import { reviewRowLabel, type ReviewRowTone } from '../lib/review-row.ts';
import { whenLabel } from '../lib/time.ts';
import { useNow } from '../lib/use-now.ts';
import { Button, splitSeamClasses } from './Button.tsx';
import { Composer, useCompose } from './Composer.tsx';
import { Glyph } from './icons.tsx';

/** What Approve does, why it is blocked, or that you already approved, for the hover title. */
function approveTitle(input: ApproveButtonInput, look: ApproveButtonLook, blocked: string | null, now: Date): string {
  const action = blocked ?? 'Approves on GitHub right away. Cannot be undone.';
  const approvedAt = input.approval?.at ?? null;
  if (!look.viewerApproved || !approvedAt) {
    return action;
  }
  const after = look.headMoved ? '; commits came after, but your approval still counts' : '';
  return `You already approved ${whenLabel(approvedAt, now)}${after}. Approving again is harmless. ${action}`;
}

const COMMENT_REVIEW_TITLE =
  'Posts a review with a comment only, no approval. It answers a review request (yours or your team\'s) without being ' +
  'the one who clears the PR for merging: branch protection does not count a comment review as an approval.';

/** The label's colour by what it says: one colour per meaning. */
const TONES: Record<ReviewRowTone, string> = {
  approved: 'text-safe',
  changes: 'text-status-bad',
  asked: 'text-honey-ink',
  plain: 'text-hint',
};

interface ReviewRowProps {
  detail: PrDetail;
  offers: PaneOffers;
  /** Who "Ask" asks: the PR's owner (`PrFacts.owners`). */
  askPerson: string;
}

/**
 * The review row, right after the glance and apart from it: the review
 * state from GitHub as its label ("Review requested from you"), then split
 * Approve (+ note), Comment review, and Ask <owner> on the right. The order
 * never changes; when Approve is core's lead it fills green, else it is
 * outlined. Each write opens the pane's composer right under the row.
 */
export function ReviewRow(props: ReviewRowProps) {
  const actions = useActions();
  const now = useNow();
  const viewer = useViewer();
  const compose = useCompose();
  const { pr } = props.detail;
  const { offers } = props;
  const viewerLogin = viewer.data?.login ?? null;
  const label = reviewRowLabel({ pr, approval: props.detail.viewerApproval, stand: props.detail.viewerReview, askedTeams: offers.removeTeams, now });
  const input: ApproveButtonInput = { isDraft: pr.isDraft, viewerLogin, reviews: pr.reviews, approval: props.detail.viewerApproval, headOid: pr.headOid };
  const look = approveButton(input);
  // The click shows the approval right away (lib/optimistic.ts); until the server confirmed, the button just says so.
  const approving = actions.isBusy(`approve:${pr.key}`);
  const variant = offers.lead === 'approve' ? 'safe' : 'secondary';
  const approveBlocked = actions.blockedReason('approve');
  const reviewBlocked = actions.blockedReason('commentReview');
  const askBlocked = actions.blockedReason('comment');
  const shortOid = pr.headOid.slice(0, 7);
  const open = compose.open?.kind ?? null;

  return (
    <div className="flex flex-col gap-2">
      <span className={`px-3 text-[11.5px] leading-[normal] font-semibold ${TONES[label.tone]}`}>{label.text}</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {offers.approve && (
          <>
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
                className={`${splitSeamClasses(variant)} px-2.5`}
                disabled={approving || approveBlocked !== null}
                aria-expanded={open === 'approve'}
                title={approveBlocked ?? 'Approve with a note: the agent drafts it, you edit it'}
                onClick={() => compose.openTarget({ kind: 'approve' })}
              >
                + note
              </Button>
            </div>
            <Button
              size="md"
              disabled={reviewBlocked !== null || actions.isBusy(`commentReview:${pr.key}`)}
              aria-expanded={open === 'comment'}
              title={reviewBlocked ?? COMMENT_REVIEW_TITLE}
              onClick={() => compose.openTarget({ kind: 'comment' })}
            >
              Comment review
            </Button>
          </>
        )}
        {offers.ask && (
          <Button
            size="md"
            className="ml-auto"
            disabled={askBlocked !== null}
            aria-expanded={open === 'ask'}
            title={askBlocked ?? `A new comment on the PR for ${props.askPerson}`}
            onClick={() => compose.openTarget({ kind: 'ask' })}
          >
            Ask {props.askPerson}
          </Button>
        )}
      </div>
      {open === 'approve' && (
        <Composer
          target={{ kind: 'approve' }}
          title="Approve with a note"
          hint={`on ${shortOid}, cannot be undone`}
          submit="Approve with note"
          variant="safe"
          write="approve"
          submitTitle="Approves on GitHub with this note. Cannot be undone."
          sending={approving}
          drafting={actions.isBusy(`reviewNote:${pr.key}`)}
          draft={(gist, quiet) => actions.draftReviewNote(pr.key, 'approve', gist, quiet)}
          draftsOnOpen
          send={(body, source) => actions.approve(pr.key, pr.headOid, body, source)}
          closesOnClick
        />
      )}
      {open === 'comment' && (
        <Composer
          target={{ kind: 'comment' }}
          title="Comment review"
          hint={`on ${shortOid}, does not approve`}
          submit="Post comment review"
          variant="primary"
          write="commentReview"
          submitTitle="Posts a comment-only review on GitHub, on the commit you see. Cannot be undone."
          sending={actions.isBusy(`commentReview:${pr.key}`)}
          drafting={actions.isBusy(`reviewNote:${pr.key}`)}
          draft={(gist, quiet) => actions.draftReviewNote(pr.key, 'comment', gist, quiet)}
          draftsOnOpen
          send={(body, source) => actions.commentReview(pr.key, pr.headOid, body, source)}
        />
      )}
      {open === 'ask' && (
        <Composer
          target={{ kind: 'ask' }}
          title={`Ask ${props.askPerson}`}
          hint="new PR comment"
          submit={`Post comment to ${props.askPerson}`}
          variant="primary"
          write="comment"
          submitTitle="Posts this comment on the PR"
          sending={actions.isBusy(`comment:${pr.key}`)}
          drafting={actions.isBusy(`ask:${pr.key}`)}
          draft={(gist) => actions.draftAsk(pr.key, props.askPerson, gist)}
          send={(body) => actions.sendComment(pr.key, body)}
        />
      )}
    </div>
  );
}
