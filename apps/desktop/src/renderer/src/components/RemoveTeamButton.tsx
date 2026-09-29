import { useEffect, useRef, useState } from 'react';
import type { PrKey } from '@postpile/core';
import { useActions } from '../api/actions.tsx';
import type { RemoveTeamButton as RemoveTeamButtonModel } from '../lib/team-request.ts';
import { Button } from './Button.tsx';

interface RemoveTeamButtonProps {
  prKey: PrKey;
  button: RemoveTeamButtonModel;
}

/**
 * "Remove team-devex" with a one-sentence confirm in a small popover. Final
 * (no undo: re-adding the team would notify every teammate again), and
 * blocked with the reason while GitHub writes are locked.
 */
export function RemoveTeamButton(props: RemoveTeamButtonProps) {
  const actions = useActions();
  const [asking, setAsking] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const blocked = actions.blockedReason('removeTeam');
  const busy = actions.isBusy(`removeTeam:${props.prKey}`);

  useEffect(() => {
    if (!asking) {
      return;
    }
    function onPointerDown(event: PointerEvent) {
      if (root.current && !root.current.contains(event.target as Node)) {
        setAsking(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setAsking(false);
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [asking]);

  function confirm() {
    setAsking(false);
    void actions.removeTeamRequest(props.prKey, props.button.team);
  }

  return (
    <div ref={root} className="relative">
      <Button
        size="md"
        disabled={blocked !== null || busy}
        title={blocked ?? 'Removes the review request for the whole team on GitHub and unsubscribes you from this PR. Cannot be undone.'}
        aria-expanded={asking}
        onClick={() => setAsking(!asking)}
      >
        {props.button.label}
      </Button>
      {asking && (
        <div role="dialog" aria-label={props.button.label} className="absolute top-full left-0 z-20 mt-1 flex w-64 flex-col gap-2 rounded-row bg-surface p-3 text-xs text-ink-2 shadow-menu">
          <p>{props.button.question}</p>
          <div className="flex justify-end gap-1.5">
            <Button onClick={() => setAsking(false)}>Cancel</Button>
            <Button variant="primary" onClick={confirm}>
              Remove
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
