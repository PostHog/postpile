import { useState } from 'react';
import { UPGRADE_COMMAND, type UpdateAction } from '@postpile/core';
import { sendTelemetry } from '../api/telemetry.ts';
import { Button } from './Button.tsx';
import { FixCommand } from './FixCommand.tsx';

/**
 * What the update reminder offers, shared by the pill's popover and the bar:
 * "Restart to update" once the update is staged, a note while it downloads,
 * or the brew command when the app cannot update itself. A fragment, so the
 * popover stacks the parts and the bar lines them up; `hintClass` colours the
 * small notes for each.
 */
export function UpdateNextStep(props: { action: UpdateAction; onRestart: () => void; hintClass: string }) {
  const [restarting, setRestarting] = useState(false);
  if (props.action === 'restart') {
    return (
      <>
        <Button
          variant="primary"
          disabled={restarting}
          title="Quit PostPile, install the update and open it again"
          onClick={() => {
            sendTelemetry('update_restart_clicked', {});
            setRestarting(true);
            props.onRestart();
          }}
        >
          {restarting ? 'Restarting…' : 'Restart to update'}
        </Button>
        <span className={props.hintClass}>Or it installs the next time PostPile quits.</span>
      </>
    );
  }
  if (props.action === 'downloading') {
    return <span className={props.hintClass}>Downloading the update…</span>;
  }
  return (
    <>
      <FixCommand command={UPGRADE_COMMAND} label={null} />
      <span className={props.hintClass}>Then quit and reopen PostPile.</span>
    </>
  );
}
