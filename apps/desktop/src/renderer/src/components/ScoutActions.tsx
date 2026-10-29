import { useState } from 'react';
import type { PrKey, ScoutFollowState } from '@postpile/core';
import { useActions } from '../api/actions.tsx';
import { followTitle } from '../lib/scouts.ts';
import { Button, type ButtonSize } from './Button.tsx';
import { Menu, type MenuItem } from './Menu.tsx';

/** "Dismiss with a reason…": one short line, kept for tuning the scout later. Empty dismisses without one. */
function DismissReasonPanel(props: { onDismiss: (reason: string) => void; close: () => void }) {
  const [reason, setReason] = useState('');
  const submit = () => {
    props.close();
    props.onDismiss(reason);
  };
  return (
    <form
      className="flex w-64 flex-col gap-2 p-2 text-xs text-ink-2"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <label className="flex flex-col gap-1">
        <span className="text-hint">Why? Optional, helps tune the scout.</span>
        <input
          autoFocus
          value={reason}
          maxLength={200}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Already know about it"
          className="h-7 rounded-control bg-surface px-2 text-xs text-ink inset-ring inset-ring-edge-control focus-visible:outline-2 focus-visible:outline-accent"
        />
      </label>
      <div className="flex justify-end gap-1.5">
        <Button onClick={props.close}>Cancel</Button>
        <Button variant="primary" type="submit">
          Dismiss
        </Button>
      </div>
    </form>
  );
}

interface ScoutActionsProps {
  /** The PR Follow subscribes to. */
  followPrKey: PrKey;
  /** The PRs Dismiss takes off the section: the whole tile on a tile, the open PR in the pane. */
  dismissPrKeys: PrKey[];
  /** A Follow of these PRs that has not reached GitHub yet. */
  follow: ScoutFollowState | null;
  from: 'tile' | 'detail';
  size?: ButtonSize;
  /** Open the Dismiss menu upwards, at the bottom of a tile. */
  up?: boolean;
}

/**
 * Follow and Dismiss on a scouted PR (DESIGN.md "Scouts"). Follow is the
 * one write: it subscribes on GitHub after the 6s undo window (the toast
 * offers Undo) or waits in the lock while writes are locked, so it goes
 * through the guard as `follow`. It is ink, never the Approve green. Dismiss
 * is local and asks for an optional reason in its menu.
 */
export function ScoutActions(props: ScoutActionsProps) {
  const actions = useActions();
  const busy = actions.isBusy(`scoutFollow:${props.followPrKey}`);
  const dismissBusy = actions.isBusy(`scoutDismiss:${props.dismissPrKeys.join(',')}`);
  const waiting = props.follow !== null;
  const blocked = actions.blockedReason('follow');
  let title = blocked ?? followTitle(actions.writes);
  if (waiting) {
    title = 'A Follow of this PR is already on its way: in its undo window, or waiting in the lock in the footer.';
  }
  const dismiss = (reason: string | null) => void actions.dismissScouted(props.dismissPrKeys, reason);
  const items: MenuItem[] = [
    { label: 'Dismiss', title: 'Takes it off the Scouted section for good. Nothing reaches GitHub.', onSelect: () => dismiss(null) },
    {
      label: 'Dismiss with a reason…',
      title: 'The reason is kept for tuning the scout later. Nothing reaches GitHub.',
      onSelect: () => {},
      panel: (close) => <DismissReasonPanel close={close} onDismiss={(reason) => dismiss(reason.trim() === '' ? null : reason)} />,
    },
  ];
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <Button
        variant="primary"
        size={props.size}
        title={title}
        disabled={waiting || busy || blocked !== null}
        onClick={() => void actions.followScouted(props.followPrKey, props.from)}
      >
        Follow
      </Button>
      <Menu label="Dismiss" size={props.size} variant="secondary" up={props.up} align="right" disabled={dismissBusy} title="Dismiss" items={items} />
    </div>
  );
}
