import { useEffect, useState } from 'react';
import { useInboxCleanup } from '../api/cleanup.ts';
import { useInterruptions } from '../api/interruptions.ts';
import { useScoutIntro } from '../api/scouts.ts';
import { scoutIntroOpens, scoutIntroWaits } from '../lib/scout-intro.ts';
import { ScoutIntroCard } from './ScoutIntroCard.tsx';

/**
 * When the Scouts intro card shows. Mounted once in App. By itself while the
 * server says `autoShow`, never on top of setup, the inbox start dialog or
 * the one-time interruptions question; always when the Scouted section's
 * "Set up a scout" asked for it (`requested`). Once open it stays mounted
 * until closed, so the prompt and the draft survive: when another overlay
 * turns up after it opened (the start dialog arrives with the start sync),
 * it hides behind it and comes back after. Closed, it does not open by
 * itself again this session.
 */
export function ScoutIntro(props: { setupBlocks: boolean; requested: boolean; onClose: () => void }) {
  const state = useScoutIntro().data;
  const cleanup = useInboxCleanup().data;
  const interruptions = useInterruptions().data;
  const [closed, setClosed] = useState(false);
  const [open, setOpen] = useState(false);
  const waits = scoutIntroWaits({ setupBlocks: props.setupBlocks, cleanup, interruptions });
  const opens = scoutIntroOpens({ state, waits, closed, requested: props.requested });
  useEffect(() => {
    if (opens) {
      setOpen(true);
    }
  }, [opens]);
  if (state === undefined || !(open || opens)) {
    return null;
  }
  const close = () => {
    setOpen(false);
    setClosed(true);
    props.onClose();
  };
  return <ScoutIntroCard state={state} hidden={waits && !props.requested} onClose={close} />;
}
