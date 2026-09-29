import { Fragment, useState, type ReactNode } from 'react';
import type { PrDetail, PrLifecycle, PrPrimaryAction, TileView } from '@postpile/core';
import { useActions } from '../api/actions.tsx';
import { useViewer } from '../api/viewer.ts';
import { approveButton, approveStateGlyphs, type ApproveButtonInput, type ApproveButtonLook } from '../lib/approve.ts';
import { isBotLogin } from '../lib/people.ts';
import { ageLabel } from '../lib/time.ts';
import { useNow } from '../lib/use-now.ts';
import { Button, buttonClasses } from './Button.tsx';
import { ChatIcon, Glyph } from './icons.tsx';
import { RecheckDialog } from './RecheckDialog.tsx';
import { SnoozeMenu } from './SnoozeMenu.tsx';
import { markReadNote } from '../lib/guard.ts';
import { glanceClaim } from '../lib/glance.ts';
import { type DetailPrimary, detailPrimary, markButtonLabel } from '../lib/mark-read.ts';

interface ActionBarProps {
  detail: PrDetail;
  view: TileView;
  chatOpen: boolean;
  onAsk: () => void;
  onToggleChat: () => void;
}

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

/** The primary action from core (`PrSummary.primaryAction`); Approve when the summary is missing. */
function primaryActionOf(props: ActionBarProps): PrPrimaryAction {
  const summary = props.view.prs.find((candidate) => candidate.key === props.detail.pr.key);
  return summary?.primaryAction ?? 'approve';
}

/** The status pill's lifecycle; derived from the PR when the summary is missing. */
function lifecycleOf(props: ActionBarProps): PrLifecycle {
  const summary = props.view.prs.find((candidate) => candidate.key === props.detail.pr.key);
  return summary?.status.lifecycle ?? (props.detail.pr.isDraft ? 'draft' : 'open');
}

/** The button slots in their fixed order; the lead one moves to the front. */
type Slot = 'approve' | 'open' | 'ask' | 'mark' | 'snooze';

const SLOT_ORDER: Slot[] = ['approve', 'open', 'ask', 'mark', 'snooze'];

function leadSlot(lead: DetailPrimary): Slot {
  if (lead === 'mark_read' || lead === 'mark_done') {
    return 'mark';
  }
  return lead === 'open_on_github' ? 'open' : lead;
}

/**
 * Approve, open, ask, mark read, snooze, chat. One ink button, the same one
 * the tile leads with (`detailPrimary`): Approve while it is due, else the
 * tile's Mark read / Mark done / Snooze, or Open on GitHub on a done tile.
 * It sits first. Approve shows on someone else's open PR, label and look
 * from `approveButton` ("Approve as well", outlined "Approve draft" /
 * "Approve again"); core's "approved" still shows it: an approval on any
 * commit counts, and re-approving is harmless. Open on GitHub shows where
 * there is nothing to approve. Approve acts on the PR, the rest on the tile.
 * The mark button says "Mark done" only where a mark-read makes the tile
 * done, and is left out while the tile is read and still your move
 * (`markButtonLabel`).
 */
export function ActionBar(props: ActionBarProps) {
  const actions = useActions();
  const now = useNow();
  const { pr } = props.detail;
  const tileId = props.view.tile.id;
  const primary = primaryActionOf(props);
  const [recheckOpen, setRecheckOpen] = useState(false);
  const viewer = useViewer();
  const approveInput: ApproveButtonInput = {
    isDraft: pr.isDraft,
    viewerLogin: viewer.data?.login ?? null,
    reviews: pr.reviews,
    approval: props.detail.viewerApproval,
    headOid: pr.headOid,
  };
  const approve = approveButton(approveInput);
  const lead = detailPrimary({ view: props.view, prAction: primary, approveVariant: approve.variant });
  const variantOf = (slot: Slot) => (leadSlot(lead) === slot ? 'primary' : 'secondary');
  const glance = props.detail.glance;
  const markReadTitle = props.view.pendingWrite
    ? 'Already pending: goes to GitHub when you unlock and send it from the footer.'
    : (actions.blockedReason('markRead') ?? markReadNote(actions.writes) ?? 'Marks the whole tile read; GitHub follows after 6s');
  const markLabel = markButtonLabel(props.view);
  const canAsk = !isBotLogin(pr.author) && props.view.prs.find((candidate) => candidate.key === pr.key)?.authorRelation !== 'you';
  const slots: Record<Slot, ReactNode> = {
    approve: (primary === 'approve' || primary === 'approved') && (
      <Button
        variant={variantOf('approve')}
        size="md"
        disabled={actions.isBusy(`approve:${pr.key}`)}
        title={approveTitle(approveInput, approve, actions.blockedReason('approve'), now)}
        onClick={() => void actions.approve(pr.key)}
      >
        {/* What you approve into: lifecycle, then review state; words in each glyph's tooltip. */}
        <span className="flex items-center gap-1 opacity-75">
          {approveStateGlyphs(lifecycleOf(props), pr.reviewDecision, props.detail.agentApprovers).map((part) => (
            <span key={part.glyph} role="img" aria-label={part.title} title={part.title} className="flex">
              <Glyph glyph={part.glyph} size={11} strokeWidth={1.8} />
            </span>
          ))}
        </span>
        {approve.label}
      </Button>
    ),
    open: (primary === 'open_on_github' || lead === 'open_on_github') && (
      <a href={pr.url} target="_blank" rel="noreferrer" title="Open the PR on github.com" className={buttonClasses(variantOf('open'), 'md')}>
        Open on GitHub
      </a>
    ),
    ask: canAsk && (
      <Button size="md" onClick={props.onAsk}>
        Ask {pr.author}
      </Button>
    ),
    mark: markLabel && (
      <Button
        variant={variantOf('mark')}
        size="md"
        title={markReadTitle}
        disabled={props.view.pendingWrite !== null}
        onClick={() => void actions.markRead(tileId, props.view.afterRead)}
      >
        {markLabel}
      </Button>
    ),
    snooze: <SnoozeMenu tileId={tileId} snoozed={props.view.state.kind === 'snoozed'} size="md" variant={variantOf('snooze')} />,
  };
  const order = [leadSlot(lead), ...SLOT_ORDER.filter((slot) => slot !== leadSlot(lead))];
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {order.map((slot) => (
        <Fragment key={slot}>{slots[slot]}</Fragment>
      ))}
      {/* Recheck and chat stay together at the end, and wrap as one when the pane is narrow. */}
      <span className="ml-auto flex items-center gap-1">
        {glance && (
          <button
            type="button"
            title="Recheck this assessment: the agent reads the whole glance against the PR, its activity and the topic dossier"
            onClick={() => setRecheckOpen(true)}
            className="h-[30px] px-2 text-xs text-muted hover:text-ink"
          >
            Recheck
          </button>
        )}
        <button
          type="button"
          aria-label="Chat about this tile"
          aria-pressed={props.chatOpen}
          title="Chat about this tile"
          onClick={props.onToggleChat}
          className={`flex size-[30px] items-center justify-center rounded-control border ${
            props.chatOpen ? 'border-accent bg-accent-soft text-accent' : 'border-control bg-surface text-ink-2 hover:bg-subtle'
          }`}
        >
          <ChatIcon />
        </button>
      </span>
      {recheckOpen && glance && (
        <RecheckDialog
          request={{ factId: null, topicId: props.detail.topicId, text: glanceClaim(glance), target: null, prKey: pr.key }}
          onClose={() => setRecheckOpen(false)}
        />
      )}
    </div>
  );
}
