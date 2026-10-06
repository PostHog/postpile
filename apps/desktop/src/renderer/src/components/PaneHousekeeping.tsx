import type { PaneOffers, PrKey, TileView } from '@postpile/core';
import { useActions } from '../api/actions.tsx';
import { markReadNote } from '../lib/guard.ts';
import { removeTeamButtons } from '../lib/team-request.ts';
import { useOpenedReadState } from '../lib/use-opened-read.ts';
import { Button } from './Button.tsx';
import { MoreIcon } from './icons.tsx';
import { MarkButton, OpenedMarkNote } from './MarkButton.tsx';
import { Menu, type MenuItem } from './Menu.tsx';
import { SnoozeMenu } from './SnoozeMenu.tsx';

/** The one-sentence confirm of "Remove <team>" inside the ⋯ menu. Final: re-adding the team notifies everyone again. */
function RemoveTeamPanel(props: { prKey: PrKey; team: string; question: string; close: () => void }) {
  const actions = useActions();
  const blocked = actions.blockedReason('removeTeam');
  return (
    <div className="flex w-64 flex-col gap-2 p-2 text-xs text-ink-2">
      <p>{props.question}</p>
      {blocked && <p className="text-hint">{blocked}</p>}
      <div className="flex justify-end gap-1.5">
        <Button onClick={props.close}>Cancel</Button>
        <Button
          variant="primary"
          disabled={blocked !== null || actions.isBusy(`removeTeam:${props.prKey}`)}
          title={blocked ?? 'Removes the review request for the whole team on GitHub and unsubscribes you from this PR. Cannot be undone.'}
          onClick={() => {
            props.close();
            void actions.removeTeamRequest(props.prKey, props.team);
          }}
        >
          Remove
        </Button>
      </div>
    </div>
  );
}

interface PaneHousekeepingProps {
  view: TileView;
  prKey: PrKey;
  offers: PaneOffers;
}

/**
 * Mark read / Done for now, Snooze and the ⋯ menu ("Remove <team>"), a
 * quiet line right under the review row: close to the tile like the review
 * buttons, but in the quiet look so nothing here competes with them. When
 * core makes one of them the lead (nothing else to do), it gets the
 * outlined look. Renders nothing when core offers none of them. After the open marked the PR, its note takes the mark
 * button's place, also once core offers no mark button.
 */
export function PaneHousekeeping(props: PaneHousekeepingProps) {
  const actions = useActions();
  const opened = useOpenedReadState();
  const { offers, prKey, view } = props;
  const tileId = view.tile.id;
  const onePr = offers.scope === 'pr';
  const pending = offers.pendingWrite;
  const row = view.prs.find((candidate) => candidate.key === prKey);
  const openedMark = opened.prKey === prKey ? opened.marked : null;
  const markLeads = offers.lead === 'mark_read' || offers.lead === 'mark_done';
  const markReadTitle = pending
    ? 'Already pending: goes to GitHub when you send it from the lock in the footer.'
    : (actions.blockedReason('markRead') ??
      markReadNote(actions.writes) ??
      (onePr ? `Marks only #${prKey.split('#')[1]} read; GitHub follows after 6s` : 'Marks the PR read; GitHub follows after 6s'));
  const markRead = () => (onePr && row ? actions.markPrRead(tileId, prKey, row.afterRead) : actions.markRead(tileId, view.afterRead));
  const removeItems: MenuItem[] = removeTeamButtons(offers.removeTeams).map((button) => ({
    label: button.label,
    onSelect: () => {},
    panel: (close) => <RemoveTeamPanel prKey={prKey} team={button.team} question={button.question} close={close} />,
  }));

  if (!openedMark && !offers.markLabel && !offers.snooze && removeItems.length === 0) {
    return null;
  }
  return (
    // Starts on the 22px line like the buttons above, so the quiet labels line up with their labels at 34.
    <div className="flex flex-wrap items-center gap-1">
      {openedMark ? (
        <OpenedMarkNote mark={openedMark} onUndo={opened.undo} />
      ) : (
        offers.markLabel && (
          <MarkButton
            prKey={prKey}
            variant={markLeads ? 'secondary' : 'quiet'}
            label={offers.markLabel}
            title={markReadTitle}
            disabled={pending !== null || actions.isBusy(onePr ? `markPr:${tileId}:${prKey}` : `markRead:${tileId}`)}
            onClick={() => void markRead()}
          />
        )
      )}
      {/* A set or stack is snoozed from its tile footer; here only a single-PR tile, where tile and PR are one. */}
      {offers.snooze && (
        <SnoozeMenu tileId={tileId} snoozed={view.state.kind === 'snoozed'} size="md" variant={offers.lead === 'snooze' ? 'secondary' : 'quiet'} />
      )}
      {removeItems.length > 0 && <Menu label={<MoreIcon />} title="More" size="icon-md" variant="quiet" items={removeItems} />}
    </div>
  );
}
