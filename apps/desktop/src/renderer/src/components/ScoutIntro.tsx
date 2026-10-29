import { useEffect, useRef, useState } from 'react';
import { useInboxCleanup } from '../api/cleanup.ts';
import { useInterruptions } from '../api/interruptions.ts';
import { useScoutIntro } from '../api/scouts.ts';
import { scoutIntroLoadRetries, scoutIntroOpens, scoutIntroWaits } from '../lib/scout-intro.ts';
import { Button } from './Button.tsx';
import { ScoutIntroCard } from './ScoutIntroCard.tsx';

/** "Set up a scout" while the card's state could not load: the error, Try again and Close. */
function ScoutIntroLoadError(props: { error: unknown; retrying: boolean; onRetry: () => void; onClose: () => void }) {
  const message = props.error instanceof Error ? props.error.message : String(props.error);
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/20 p-4">
      <div role="alertdialog" aria-labelledby="scout-intro-error" className="flex w-[420px] max-w-full flex-col gap-3 rounded-[16px] bg-surface px-6 py-5 shadow-menu">
        <h2 id="scout-intro-error" className="text-[15px] font-semibold text-ink">
          Could not load the scout setup
        </h2>
        <p className="text-[12.5px] leading-[1.45] text-ink-2 [overflow-wrap:anywhere]">{message}</p>
        <div className="flex justify-end gap-2.5">
          <Button size="md" onClick={props.onClose}>
            Close
          </Button>
          <Button variant="primary" size="md" disabled={props.retrying} onClick={props.onRetry}>
            {props.retrying ? 'Trying…' : 'Try again'}
          </Button>
        </div>
      </div>
    </div>
  );
}

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
  const intro = useScoutIntro();
  const state = intro.data;
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
  // "Set up a scout" after the state failed to load asks again, once per click; after that only "Try again" does.
  const { refetch } = intro;
  const failed = state === undefined && intro.isError;
  const retried = useRef(false);
  useEffect(() => {
    if (!props.requested) {
      retried.current = false;
      return;
    }
    if (scoutIntroLoadRetries({ requested: props.requested, failed, retried: retried.current })) {
      retried.current = true;
      void refetch();
    }
    // Only a new click runs this: a failure that comes back must not ask again by itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.requested]);
  // One way to close for the card and the load error alike: a later load must not reopen what the user closed.
  const close = () => {
    setOpen(false);
    setClosed(true);
    props.onClose();
  };
  if (state === undefined && props.requested && intro.isError) {
    return <ScoutIntroLoadError error={intro.error} retrying={intro.isFetching} onRetry={() => void refetch()} onClose={close} />;
  }
  if (state === undefined || !(open || opens)) {
    return null;
  }
  return <ScoutIntroCard state={state} hidden={waits && !props.requested} onClose={close} />;
}
