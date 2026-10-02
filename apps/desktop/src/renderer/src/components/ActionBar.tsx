import { Fragment, useState, type ReactNode } from 'react';
import type { PaneLead, PaneOffers, PrDetail, TileView } from '@postpile/core';
import { useActions } from '../api/actions.tsx';
import { ApproveButtons } from './ApproveButtons.tsx';
import { Button, buttonClasses } from './Button.tsx';
import { ComposeAnchor, type ComposeKind } from './ComposePopover.tsx';
import { ChatIcon } from './icons.tsx';
import { MarkButton, OpenedMarkNote } from './MarkButton.tsx';
import { RecheckDialog } from './RecheckDialog.tsx';
import { RemoveTeamButton } from './RemoveTeamButton.tsx';
import { SnoozeMenu } from './SnoozeMenu.tsx';
import { markReadNote } from '../lib/guard.ts';
import { glanceClaim } from '../lib/glance.ts';
import { removeTeamButtons } from '../lib/team-request.ts';
import { useOpenedReadState } from '../lib/use-opened-read.ts';

interface ActionBarProps {
  detail: PrDetail;
  view: TileView;
  chatOpen: boolean;
  onToggleChat: () => void;
}

/** Only Open, for a PR the tile has no row for (it left the tile since the pane opened). */
const ONLY_OPEN: PaneOffers = {
  scope: 'tile',
  lead: 'open_on_github',
  approve: false,
  open: true,
  ask: false,
  markLabel: null,
  snooze: false,
  removeTeams: [],
  pendingWrite: null,
};


/** The button slots in their fixed order; the lead one moves to the front. */
type Slot = 'approve' | 'open' | 'ask' | 'mark' | 'snooze' | 'removeTeam';

const SLOT_ORDER: Slot[] = ['approve', 'open', 'ask', 'mark', 'snooze', 'removeTeam'];

function leadSlot(lead: PaneLead): Slot {
  if (lead === 'mark_read' || lead === 'mark_done') {
    return 'mark';
  }
  return lead === 'open_on_github' ? 'open' : lead;
}

/**
 * Approve, open, ask, mark read, snooze, chat. Which buttons show and which
 * one leads come from core (`TileView.offers.pane`, `paneOffers`); this only
 * lays them out. The lead is the one ink button and sits first. Approve is
 * split (`ApproveButtons`: approve now, or with a note) with "Comment
 * review" next to it. Ask, Approve with comment and Comment review share one
 * compose popover, one open at a time. On a stack or set (`scope: 'pr'`)
 * everything acts on the selected PR; on a single-PR tile the buttons behave
 * as the tile's. A done tile or PR offers only Open on GitHub.
 */
export function ActionBar(props: ActionBarProps) {
  const actions = useActions();
  const opened = useOpenedReadState();
  const { pr } = props.detail;
  const tileId = props.view.tile.id;
  const offers = props.view.offers.pane[pr.key] ?? ONLY_OPEN;
  const [recheckOpen, setRecheckOpen] = useState(false);
  const [compose, setCompose] = useState<ComposeKind | null>(null);
  const toggleCompose = (kind: ComposeKind) => setCompose(compose === kind ? null : kind);
  const closeCompose = () => setCompose(null);
  const lead = leadSlot(offers.lead);
  const variantOf = (slot: Slot) => (lead === slot ? 'primary' : 'secondary');
  const glance = props.detail.glance;
  const onePr = offers.scope === 'pr';
  const pending = offers.pendingWrite;
  const markReadTitle = pending
    ? 'Already pending: goes to GitHub when you unlock and send it from the footer.'
    : (actions.blockedReason('markRead') ??
      markReadNote(actions.writes) ??
      (onePr ? `Marks only #${pr.ref.number} read; GitHub follows after 6s` : 'Marks the PR read; GitHub follows after 6s'));
  const row = props.view.prs.find((candidate) => candidate.key === pr.key);
  // The PR's owner: its author, or the person a bot opened it for.
  const askPerson = row?.facts.owners[0] ?? pr.author;
  const openedMark = opened.prKey === pr.key ? opened.marked : null;
  const markRead = () => (onePr && row ? actions.markPrRead(tileId, pr.key, row.afterRead) : actions.markRead(tileId, props.view.afterRead));
  const slots: Record<Slot, ReactNode> = {
    approve: offers.approve && (
      <ApproveButtons detail={props.detail} leads={lead === 'approve'} compose={compose} onToggleCompose={toggleCompose} onCloseCompose={closeCompose} />
    ),
    open: offers.open && (
      <a href={pr.url} target="_blank" rel="noreferrer" title="Open the PR on github.com" className={buttonClasses(variantOf('open'), 'md')}>
        Open on GitHub
      </a>
    ),
    ask: offers.ask && (
      <ComposeAnchor compose={compose} kinds={['ask']} prKey={pr.key} headOid={pr.headOid} askPerson={askPerson} onClose={closeCompose}>
        <Button size="md" aria-expanded={compose === 'ask'} onClick={() => toggleCompose('ask')}>
          Ask {askPerson}
        </Button>
      </ComposeAnchor>
    ),
    // After the open marked the PR the note takes the button's place, also once core offers no mark button (the PR is done).
    mark: openedMark ? (
      <OpenedMarkNote mark={openedMark} onUndo={opened.undo} />
    ) : (
      offers.markLabel && (
        <MarkButton
          prKey={pr.key}
          variant={variantOf('mark')}
          label={offers.markLabel}
          title={markReadTitle}
          disabled={pending !== null || actions.isBusy(onePr ? `markPr:${tileId}:${pr.key}` : `markRead:${tileId}`)}
          onClick={() => void markRead()}
        />
      )
    ),
    // One "Remove <team>" per team of yours still asked on this PR; never the lead.
    removeTeam: removeTeamButtons(offers.removeTeams).map((button) => (
      <RemoveTeamButton key={button.team} prKey={pr.key} button={button} />
    )),
    // A set or stack is snoozed from its tile footer; here only a single-PR tile, where tile and PR are one. A done tile has no Snooze.
    snooze: offers.snooze && <SnoozeMenu tileId={tileId} snoozed={props.view.state.kind === 'snoozed'} size="md" variant={variantOf('snooze')} />,
  };
  const order = [lead, ...SLOT_ORDER.filter((slot) => slot !== lead)];
  return (
    // No rules above or below: spacing alone sets the bar apart.
    <div className="flex flex-wrap items-center gap-1.5 pt-1.5 pb-2.5">
      {order.map((slot) => (
        <Fragment key={slot}>{slots[slot]}</Fragment>
      ))}
      {/* Recheck and chat stay together at the end, and wrap as one when the pane is narrow. */}
      <span className="ml-auto flex items-center gap-1.5">
        {glance && (
          <button
            type="button"
            title="Recheck this assessment: the agent reads the whole glance against the PR, its activity and the topic dossier"
            onClick={() => setRecheckOpen(true)}
            className="h-[30px] px-2 text-xs text-hint hover:text-ink"
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
          className={`flex size-[30px] items-center justify-center rounded-control inset-ring ${
            props.chatOpen ? 'bg-accent-soft text-accent inset-ring-accent' : 'bg-surface text-ink-2 shadow-control inset-ring-edge-control hover:bg-subtle'
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
