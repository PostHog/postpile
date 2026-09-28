import { useState } from 'react';
import type { PrDetail, PrLifecycle, PrPrimaryAction, TileView } from '@postpile/core';
import { useActions } from '../api/actions.tsx';
import { useViewer } from '../api/viewer.ts';
import { approveButton, approveStateGlyphs, type ApproveButtonInput, type ApproveButtonLook } from '../lib/approve.ts';
import { isBotLogin } from '../lib/people.ts';
import { ageLabel } from '../lib/time.ts';
import { useNow } from '../lib/use-now.ts';
import { Button } from './Button.tsx';
import { ChatIcon, Glyph } from './icons.tsx';
import { RecheckDialog } from './RecheckDialog.tsx';
import { SnoozeMenu } from './SnoozeMenu.tsx';
import { markReadNote } from '../lib/guard.ts';
import { glanceClaim } from '../lib/glance.ts';

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

/**
 * Primary, ask, mark read, snooze, chat. The primary button comes from core:
 * Approve on someone else's open PR, label and look from `approveButton`
 * ("Approve as well", outlined "Approve draft" / "Approve again"). Core's
 * "approved" still shows the button: an approval on any commit counts, and
 * re-approving is harmless. On your own
 * PR, or a merged or closed one, Mark read while the tile is unread, else
 * Open on GitHub. Approve acts on the PR, the rest on the tile.
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
  const glance = props.detail.glance;
  const markReadTitle = props.view.pendingWrite
    ? 'Already pending: goes to GitHub when you unlock and send it from the footer.'
    : (actions.blockedReason('markRead') ?? markReadNote(actions.writes) ?? 'Marks the whole tile read; GitHub follows after 6s');
  const markRead = (variant: 'primary' | 'secondary') => (
    <Button variant={variant} size="md" title={markReadTitle} disabled={props.view.pendingWrite !== null} onClick={() => void actions.markRead(tileId)}>
      Mark read
    </Button>
  );
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {(primary === 'approve' || primary === 'approved') && (
        <Button
          variant={approve.variant}
          size="md"
          disabled={actions.isBusy(`approve:${pr.key}`)}
          title={approveTitle(approveInput, approve, actions.blockedReason('approve'), now)}
          onClick={() => void actions.approve(pr.key)}
        >
          {/* What you approve into: lifecycle, then review state; words in each glyph's tooltip. */}
          <span className="flex items-center gap-1 opacity-75">
            {approveStateGlyphs(lifecycleOf(props), pr.reviewDecision).map((part) => (
              <span key={part.glyph} role="img" aria-label={part.title} title={part.title} className="flex">
                <Glyph glyph={part.glyph} size={11} strokeWidth={1.8} />
              </span>
            ))}
          </span>
          {approve.label}
        </Button>
      )}
      {primary === 'mark_read' && markRead('primary')}
      {primary === 'open_on_github' && (
        <a
          href={pr.url}
          target="_blank"
          rel="noreferrer"
          title="Open the PR on github.com"
          className="flex h-[30px] shrink-0 items-center rounded-control bg-ink px-3 text-[12.5px] font-semibold whitespace-nowrap text-on-ink shadow-primary hover:bg-ink-2"
        >
          Open on GitHub
        </a>
      )}
      {!isBotLogin(pr.author) && props.view.prs.find((candidate) => candidate.key === pr.key)?.authorRelation !== 'you' && (
        <Button size="md" onClick={props.onAsk}>
          Ask {pr.author}
        </Button>
      )}
      {primary !== 'mark_read' && markRead('secondary')}
      <SnoozeMenu tileId={tileId} snoozed={props.view.state.kind === 'snoozed'} size="md" />
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
